import Redis from 'ioredis';

type RedisEndpoint = {
  label: string;
  client: Redis;
  enabled: boolean;
};

function isQuotaError(message: string): boolean {
  return message.includes('max requests limit') || message.includes('limit exceeded');
}

function isRedisDeadError(message: string): boolean {
  return (
    message.includes('Connection is closed')
    || message.includes('ECONNREFUSED')
    || message.includes('ENOTFOUND')
    || message.includes('Stream isn\'t writeable')
  );
}

/** Collect REDIS_URL, REDIS_URL_1..9, and comma-separated REDIS_URLS (deduped). */
export function collectRedisUrls(): string[] {
  const urls: string[] = [];
  const add = (raw: string | undefined) => {
    const trimmed = raw?.trim();
    if (trimmed) urls.push(trimmed);
  };

  add(process.env['REDIS_URL']);

  for (let i = 1; i <= 9; i++) {
    add(process.env[`REDIS_URL_${i}`]);
  }

  const list = process.env['REDIS_URLS'];
  if (list?.trim()) {
    for (const part of list.split(',')) add(part);
  }

  return [...new Set(urls)];
}

function createRedisClient(url: string, label: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableReadyCheck: false,
    retryStrategy: (times) => {
      if (times > 4) return null;
      return Math.min(times * 400, 2000);
    },
  });

  client.on('connect', () => console.log(`[Redis] Connected (${label})`));
  bindRedisClientGuards(client, label);
  return client;
}

const redisUrls = collectRedisUrls();
let redisEnabled = redisUrls.length > 0;
const endpoints: RedisEndpoint[] = redisUrls.map((url, index) => ({
  label: redisUrls.length === 1 ? 'main' : `url-${index + 1}`,
  client: createRedisClient(url, redisUrls.length === 1 ? 'main' : `url-${index + 1}`),
  enabled: true,
}));

let activeIndex = 0;

const fallbackClient = new Redis('redis://127.0.0.1:6379', {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: false,
  retryStrategy: () => null,
});

function endpointUsable(ep: RedisEndpoint): boolean {
  if (!ep.enabled) return false;
  const status = ep.client.status;
  return status === 'ready' || status === 'connect' || status === 'connecting';
}

function getActiveEndpoint(): RedisEndpoint | null {
  if (!redisEnabled || endpoints.length === 0) return null;

  for (let n = 0; n < endpoints.length; n++) {
    const idx = (activeIndex + n) % endpoints.length;
    const ep = endpoints[idx];
    if (ep.enabled && endpointUsable(ep)) {
      activeIndex = idx;
      return ep;
    }
  }

  for (let n = 0; n < endpoints.length; n++) {
    const idx = (activeIndex + n) % endpoints.length;
    const ep = endpoints[idx];
    if (ep.enabled) {
      activeIndex = idx;
      return ep;
    }
  }

  return null;
}

/** Active pooled Redis client (failover across REDIS_URL / REDIS_URL_1..n). */
export function getRedis(): Redis {
  return getActiveEndpoint()?.client ?? endpoints[0]?.client ?? fallbackClient;
}

/** Backward-compatible export — forwards to the active pooled client. */
export const redis: Redis = new Proxy(fallbackClient, {
  get(_target, prop) {
    const client = getRedis();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

function syncRedisEnabledFlag(): void {
  redisEnabled = endpoints.some((ep) => ep.enabled);
  if (!redisEnabled) {
    console.warn('[Redis] All endpoints disabled — running without Redis cache');
  }
}

function disableEndpoint(ep: RedisEndpoint, reason: string): void {
  if (!ep.enabled) return;
  ep.enabled = false;
  console.warn(`[Redis] Endpoint ${ep.label} disabled (${reason})`);
  try {
    ep.client.disconnect(false);
  } catch {
    /* ignore */
  }
  syncRedisEnabledFlag();
  if (redisEnabled) {
    activeIndex = (activeIndex + 1) % endpoints.length;
  }
}

/** Disable every Redis endpoint for this process. */
export function disableRedis(reason?: string): void {
  for (const ep of endpoints) {
    if (ep.enabled) disableEndpoint(ep, reason ?? 'manual');
  }
}

/** @deprecated Use disableRedis */
export function disableRedisDueToQuota(reason?: string): void {
  const ep = getActiveEndpoint();
  if (ep) disableEndpoint(ep, reason ?? 'quota');
  else disableRedis(reason ?? 'quota');
}

/** Prevent uncaught ReplyError crashes on pub/sub or duplicate clients. */
export function bindRedisClientGuards(client: Redis, label: string): void {
  client.on('error', (err) => {
    const msg = err.message;
    console.warn(`[Redis] ${label} error:`, msg);
    if (isQuotaError(msg)) {
      const ep = endpoints.find((e) => e.client === client);
      if (ep) disableEndpoint(ep, msg);
    }
  });
}

export function hasRedisConfigured(): boolean {
  return redisUrls.length > 0;
}

export function isRedisOperational(): boolean {
  if (!redisEnabled) return false;
  return endpoints.some((ep) => ep.enabled && endpointUsable(ep));
}

export function getRedisPoolStatus(): Array<{ label: string; enabled: boolean; status: string; active: boolean }> {
  const active = getActiveEndpoint();
  return endpoints.map((ep) => ({
    label: ep.label,
    enabled: ep.enabled,
    status: ep.client.status,
    active: ep === active,
  }));
}

export async function connectRedisOptional(): Promise<boolean> {
  if (!hasRedisConfigured()) {
    console.warn('[Redis] No Redis URLs configured — running without Redis cache');
    redisEnabled = false;
    return false;
  }

  console.log(`[Redis] Pool: ${endpoints.length} endpoint(s) configured`);

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    if (!ep.enabled) continue;

    try {
      if (ep.client.status === 'wait' || ep.client.status === 'end') {
        await ep.client.connect();
      }
      await ep.client.ping();
      activeIndex = i;
      redisEnabled = true;
      console.log(`[Redis] Using endpoint ${ep.label}`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[Redis] ${ep.label} connect failed:`, msg);
      if (isQuotaError(msg) || isRedisDeadError(msg)) {
        disableEndpoint(ep, msg);
      }
    }
  }

  syncRedisEnabledFlag();
  return isRedisOperational();
}

/** Run a Redis op on the active endpoint; failover to the next URL on quota/dead errors. */
export async function safeRedis<T>(fallback: T, op: (client: Redis) => Promise<T>): Promise<T> {
  if (!redisEnabled || endpoints.length === 0) return fallback;

  const tried = new Set<RedisEndpoint>();
  for (let attempt = 0; attempt < endpoints.length; attempt++) {
    const ep = getActiveEndpoint();
    if (!ep || tried.has(ep)) break;
    tried.add(ep);

    if (!ep.enabled) continue;

    try {
      if (ep.client.status === 'wait' || ep.client.status === 'end') {
        await ep.client.connect();
      }
      return await op(ep.client);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaError(msg) || isRedisDeadError(msg)) {
        disableEndpoint(ep, msg);
        continue;
      }
      console.warn('[Redis] Operation failed:', msg);
      return fallback;
    }
  }

  return fallback;
}

export function disconnectAllRedis(): void {
  for (const ep of endpoints) {
    try {
      ep.client.disconnect(false);
    } catch {
      /* ignore */
    }
  }
  try {
    fallbackClient.disconnect(false);
  } catch {
    /* ignore */
  }
}

const SESSION_TTL = 60 * 60 * 24;

export async function setSessionState(sessionId: string, data: unknown): Promise<void> {
  await safeRedis(undefined, (client) =>
    client.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(data)),
  );
}

export async function getSessionState<T>(sessionId: string): Promise<T | null> {
  return safeRedis(null, async (client) => {
    const raw = await client.get(`session:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  });
}

export async function deleteSessionState(sessionId: string): Promise<void> {
  await safeRedis(undefined, (client) => client.del(`session:${sessionId}`));
}

export async function setRoomUsers(sessionId: string, userIds: string[]): Promise<void> {
  await safeRedis(undefined, (client) =>
    client.setex(`room:${sessionId}:users`, SESSION_TTL, JSON.stringify(userIds)),
  );
}

export async function getRoomUsers(sessionId: string): Promise<string[]> {
  return safeRedis([], async (client) => {
    const raw = await client.get(`room:${sessionId}:users`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  });
}

export async function setSessionFog(sessionId: string, fogData: string): Promise<void> {
  await safeRedis(undefined, (client) =>
    client.setex(`fog:${sessionId}`, SESSION_TTL, fogData),
  );
}

export async function getSessionFog(sessionId: string): Promise<string | null> {
  return safeRedis(null, (client) => client.get(`fog:${sessionId}`));
}

export async function setSessionItems(sessionId: string, itemsData: string): Promise<void> {
  await safeRedis(undefined, (client) =>
    client.setex(`items:${sessionId}`, SESSION_TTL, itemsData),
  );
}

export async function getSessionItems(sessionId: string): Promise<string | null> {
  return safeRedis(null, (client) => client.get(`items:${sessionId}`));
}
