import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { redis, isRedisOperational } from './redis';

let attached = false;

/**
 * Enables cross-instance Socket.io rooms when Redis is available.
 * Set SOCKET_REDIS_ADAPTER=0 to disable (single-instance only).
 */
export async function attachRedisSocketAdapter(io: Server): Promise<boolean> {
  if (attached) return true;
  if (process.env['SOCKET_REDIS_ADAPTER'] === '0') {
    console.log('[Socket] Redis adapter disabled (SOCKET_REDIS_ADAPTER=0)');
    return false;
  }
  if (!process.env['REDIS_URL']) return false;
  if (!isRedisOperational()) return false;

  try {
    const pubClient = redis.duplicate();
    const subClient = redis.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    attached = true;
    console.log('[Socket] Redis adapter attached — multi-instance rooms enabled');
    return true;
  } catch (err) {
    console.warn(
      '[Socket] Redis adapter failed — running single-instance socket rooms:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export function isRedisSocketAdapterAttached(): boolean {
  return attached;
}
