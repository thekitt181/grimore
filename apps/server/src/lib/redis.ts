import Redis from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
});

redis.on('connect', () => console.log('[Redis] Connected'));
redis.on('error', (err) => console.error('[Redis] Error:', err.message));

// ─── Session state helpers ─────────────────────────────────────────────────────

const SESSION_TTL = 60 * 60 * 24; // 24 hours in seconds

export async function setSessionState(sessionId: string, data: unknown): Promise<void> {
  await redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(data));
}

export async function getSessionState<T>(sessionId: string): Promise<T | null> {
  const raw = await redis.get(`session:${sessionId}`);
  if (!raw) return null;
  return JSON.parse(raw) as T;
}

export async function deleteSessionState(sessionId: string): Promise<void> {
  await redis.del(`session:${sessionId}`);
}

export async function setRoomUsers(sessionId: string, userIds: string[]): Promise<void> {
  await redis.setex(`room:${sessionId}:users`, SESSION_TTL, JSON.stringify(userIds));
}

export async function getRoomUsers(sessionId: string): Promise<string[]> {
  try {
    const raw = await redis.get(`room:${sessionId}:users`);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === 'string');
  } catch {
    return [];
  }
}

export async function setSessionFog(sessionId: string, fogData: string): Promise<void> {
  await redis.setex(`fog:${sessionId}`, SESSION_TTL, fogData);
}

export async function getSessionFog(sessionId: string): Promise<string | null> {
  return redis.get(`fog:${sessionId}`);
}

export async function setSessionItems(sessionId: string, itemsData: string): Promise<void> {
  await redis.setex(`items:${sessionId}`, SESSION_TTL, itemsData);
}

export async function getSessionItems(sessionId: string): Promise<string | null> {
  return redis.get(`items:${sessionId}`);
}
