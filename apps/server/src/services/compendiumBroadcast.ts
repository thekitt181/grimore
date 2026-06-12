import type { Server } from 'socket.io';
import type { CatalogRebuildProgress, ServerToClientEvents, ClientToServerEvents } from '@grimoire/shared';

let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
let pendingBroadcast: ReturnType<typeof setTimeout> | null = null;
let pendingLastUpdated = '';

export function setCompendiumSocketServer(
  server: Server<ClientToServerEvents, ServerToClientEvents>,
): void {
  io = server;
}

export function getSocketServer(): Server<ClientToServerEvents, ServerToClientEvents> | null {
  return io;
}

export function broadcastCompendiumUpdated(lastUpdated: string): void {
  if (!io) return;
  pendingLastUpdated = lastUpdated;
  if (pendingBroadcast) return;
  pendingBroadcast = setTimeout(() => {
    pendingBroadcast = null;
    io?.emit('compendium:updated', { lastUpdated: pendingLastUpdated });
  }, 400);
}

export function broadcastCatalogRebuildProgress(payload: CatalogRebuildProgress): void {
  io?.emit('compendium:catalog-rebuild', payload);
}
