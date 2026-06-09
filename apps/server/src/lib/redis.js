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
export async function setSessionState(sessionId, data) {
    await redis.setex(`session:${sessionId}`, SESSION_TTL, JSON.stringify(data));
}
export async function getSessionState(sessionId) {
    const raw = await redis.get(`session:${sessionId}`);
    if (!raw)
        return null;
    return JSON.parse(raw);
}
export async function deleteSessionState(sessionId) {
    await redis.del(`session:${sessionId}`);
}
export async function setRoomUsers(sessionId, userIds) {
    await redis.setex(`room:${sessionId}:users`, SESSION_TTL, JSON.stringify(userIds));
}
export async function getRoomUsers(sessionId) {
    const raw = await redis.get(`room:${sessionId}:users`);
    if (!raw)
        return [];
    return JSON.parse(raw);
}
export async function setSessionFog(sessionId, fogData) {
    await redis.setex(`fog:${sessionId}`, SESSION_TTL, fogData);
}
export async function getSessionFog(sessionId) {
    return redis.get(`fog:${sessionId}`);
}
export async function setSessionItems(sessionId, itemsData) {
    await redis.setex(`items:${sessionId}`, SESSION_TTL, itemsData);
}
export async function getSessionItems(sessionId) {
    return redis.get(`items:${sessionId}`);
}
//# sourceMappingURL=redis.js.map