import type { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents } from '@grimoire/shared';

let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;

export function setCompendiumSocketServer(
  server: Server<ClientToServerEvents, ServerToClientEvents>,
): void {
  io = server;
}

export function getSocketServer(): Server<ClientToServerEvents, ServerToClientEvents> | null {
  return io;
}

export function broadcastCompendiumUpdated(lastUpdated: string): void {
  io?.emit('compendium:updated', { lastUpdated });
}
