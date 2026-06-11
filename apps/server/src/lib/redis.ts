import Redis from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

let redisEnabled = Boolean(process.env['REDIS_URL']);

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

/** Disable Redis for this process (quota, disconnect, repeated failures). Never throws. */
export function disableRedis(reason?: string): void {
  if (!redisEnabled) return;
  redisEnabled = false;
  console.warn(
    '[Redis] Disabled for this server instance',
    reason ? `(${reason})` : '',
  );
  try {
    redis.disconnect(false);
  } catch {
    /* ignore */
  }
}

/** @deprecated Use disableRedis */
export function disableRedisDueToQuota(reason?: string): void {
  disableRedis(reason ?? 'quota');
}

/** Prevent uncaught ReplyError crashes on pub/sub or duplicate clients. */
export function bindRedisClientGuards(client: Redis, label: string): void {
  client.on('error', (err) => {
    const msg = err.message;
    console.warn(`[Redis] ${label} error:`, msg);
    if (isQuotaError(msg)) {
      disableRedisDueToQuota(label);
    }
  });
}

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  enableReadyCheck: false,
  retryStrategy: (times) => {
    if (!redisEnabled) return null;
    if (times > 4) return null;
    return Math.min(times * 400, 2000);
  },
});

redis.on('connect', () => console.log('[Redis] Connected'));
bindRedisClientGuards(redis, 'main');
redis.on('error', (err) => {
  const msg = err.message;
  if (isQuotaError(msg)) {
    disableRedisDueToQuota('main');
  }
});

export function isRedisOperational(): boolean {
  if (!redisEnabled) return false;
  const status = redis.status;
  return status === 'ready' || status === 'connect' || status === 'connecting';
}

export async function connectRedisOptional(): Promise<boolean> {
  if (!process.env['REDIS_URL']) {
    console.warn('[Redis] REDIS_URL not set - running without Redis cache');
    redisEnabled = false;
    return false;
  }
  try {
    if (redis.status === 'ready' || redis.status === 'connect') {
      return isRedisOperational();
    }
    if (redis.status === 'connecting') {
      await redis.ping();
      return isRedisOperational();
    }
    await redis.connect();
    await redis.ping();
    return isRedisOperational();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Redis] Startup connect failed - running without Redis:', msg);
    if (isQuotaError(msg)) disableRedisDueToQuota('startup');
    return false;
  }
}

/** Run a Redis op when connected; return fallback silently when Redis is off or dead. */
export async function safeRedis<T>(fallback: T, op: () => Promise<T>): Promise<T> {
  if (!isRedisOperational()) return fallback;
  try {
    return await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (isQuotaError(msg) || isRedisDeadError(msg)) {
      disableRedis(msg);
    } else {
      console.warn('[Redis] Operation failed:', msg);
    }
    return fallback;
  }
}

const SESSION_TTL = 60 * 60 * 24;

export async function setSessionState(sessionId: string, data: unknown): Promise<void> {
  await safeRedis(undefined, () =>
    redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(data)),
  );
}

export async function getSessionState<T>(sessionId: string): Promise<T | null> {
  return safeRedis(null, async () => {
    const raw = await redis.get(`session:${sessionId}`);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  });
}

export async function deleteSessionState(sessionId: string): Promise<void> {
  await safeRedis(undefined, () => redis.del(`session:${sessionId}`));
}

export async function setRoomUsers(sessionId: string, userIds: string[]): Promise<void> {
  await safeRedis(undefined, () =>
    redis.setex(`room:${sessionId}:users`, SESSION_TTL, JSON.stringify(userIds)),
  );
}

export async function getRoomUsers(sessionId: string): Promise<string[]> {
  return safeRedis([], async () => {
    const raw = await redis.get(`room:${sessionId}:users`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  });
}

export async function setSessionFog(sessionId: string, fogData: string): Promise<void> {
  await safeRedis(undefined, () =>
    redis.setex(`fog:${sessionId}`, SESSION_TTL, fogData),
  );
}

export async function getSessionFog(sessionId: string): Promise<string | null> {
  return safeRedis(null, () => redis.get(`fog:${sessionId}`));
}

export async function setSessionItems(sessionId: string, itemsData: string): Promise<void> {
  await safeRedis(undefined, () =>
    redis.setex(`items:${sessionId}`, SESSION_TTL, itemsData),
  );
}

export async function getSessionItems(sessionId: string): Promise<string | null> {
  return safeRedis(null, () => redis.get(`items:${sessionId}`));
}
