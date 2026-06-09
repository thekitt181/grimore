import Redis from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

let redisEnabled = Boolean(process.env['REDIS_URL']);

function isQuotaError(message: string): boolean {
  return message.includes('max requests limit') || message.includes('limit exceeded');
}

export const redis = new Redis(REDIS_URL, {
  // Avoid throwing on every command when disconnected (Upstash quota / outages).
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
redis.on('error', (err) => {
  const msg = err.message;
  console.warn('[Redis] Error:', msg);
  if (isQuotaError(msg)) {
    redisEnabled = false;
    console.warn('[Redis] Quota or limit hit — disabling Redis for this server instance');
    try {
      redis.disconnect(false);
    } catch {
      /* ignore */
    }
  }
});

/** True when Redis accepted a connection and has not been disabled due to quota/errors. */
export function isRedisOperational(): boolean {
  return redisEnabled && (redis.status === 'ready' || redis.status === 'connect');
}

/** Connect at startup; never throws — returns false when Redis is unavailable. */
export async function connectRedisOptional(): Promise<boolean> {
  if (!process.env['REDIS_URL']) {
    console.warn('[Redis] REDIS_URL not set — running without Redis cache');
    redisEnabled = false;
    return false;
  }
  try {
    if (redis.status === 'ready' || redis.status === 'connect' || redis.status === 'connecting') {
      return true;
    }
    await redis.connect();
    return isRedisOperational();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Redis] Startup connect failed — running without Redis:', msg);
    if (isQuotaError(msg)) redisEnabled = false;
    return false;
  }
}

async function safeRedis<T>(fallback: T, op: () => Promise<T>): Promise<T> {
  if (!redisEnabled) return fallback;
  try {
    if (redis.status === 'end') return fallback;
    return await op();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn('[Redis] Operation failed:', msg);
    if (isQuotaError(msg)) {
      redisEnabled = false;
      try {
        redis.disconnect(false);
      } catch {
        /* ignore */
      }
    }
    return fallback;
  }
}

// ─── Session state helpers ─────────────────────────────────────────────────────

const SESSION_TTL = 60 * 60 * 24; // 24 hours in seconds

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
