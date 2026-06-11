import type { Redis } from 'ioredis';
import type { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import {
  bindRedisClientGuards,
  disableRedisDueToQuota,
  getRedis,
  hasRedisConfigured,
  isRedisOperational,
} from './redis';

let attached = false;

/** True when cross-instance Socket.io Redis adapter is explicitly enabled. */
export function isSocketRedisAdapterEnabled(): boolean {
  return process.env['SOCKET_REDIS_ADAPTER'] === '1';
}

async function connectDuplicateClient(client: Redis, label: string): Promise<boolean> {
  bindRedisClientGuards(client, label);
  try {
    if (client.status === 'wait' || client.status === 'end') {
      await client.connect();
    }
    await client.ping();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[Socket] Redis ${label} client unavailable:`, msg);
    if (msg.includes('max requests limit') || msg.includes('limit exceeded')) {
      disableRedisDueToQuota(`socket-${label}`);
    }
    try {
      client.disconnect(false);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/**
 * Enables cross-instance Socket.io rooms when Redis is available.
 * Off by default — set SOCKET_REDIS_ADAPTER=1 only for multi-instance deploys.
 */
export async function attachRedisSocketAdapter(io: Server): Promise<boolean> {
  if (attached) return true;
  if (!isSocketRedisAdapterEnabled()) {
    console.log('[Socket] Single-instance mode (SOCKET_REDIS_ADAPTER not set to 1)');
    return false;
  }
  if (!hasRedisConfigured()) return false;
  if (!isRedisOperational()) return false;

  let pubClient: Redis | null = null;
  let subClient: Redis | null = null;

  try {
    const active = getRedis();
    await active.ping();

    pubClient = active.duplicate();
    subClient = active.duplicate();

    const [pubOk, subOk] = await Promise.all([
      connectDuplicateClient(pubClient, 'pub'),
      connectDuplicateClient(subClient, 'sub'),
    ]);

    if (!pubOk || !subOk) {
      console.warn('[Socket] Redis adapter skipped — pub/sub clients could not connect');
      return false;
    }

    io.adapter(createAdapter(pubClient, subClient));
    attached = true;
    console.log('[Socket] Redis adapter attached — multi-instance rooms enabled');
    return true;
  } catch (err) {
    console.warn(
      '[Socket] Redis adapter failed — running single-instance socket rooms:',
      err instanceof Error ? err.message : err,
    );
    try {
      pubClient?.disconnect(false);
    } catch {
      /* ignore */
    }
    try {
      subClient?.disconnect(false);
    } catch {
      /* ignore */
    }
    return false;
  }
}

export function isRedisSocketAdapterAttached(): boolean {
  return attached;
}
