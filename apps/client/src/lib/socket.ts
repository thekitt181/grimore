import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@grimoire/shared';
import { getServerOrigin } from './appUrls';

const SERVER_URL = getServerOrigin();
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export async function connectSocket(token: string): Promise<void> {
  const s = getSocket();
  s.auth = { token };
  if (!s.connected) {
    s.connect();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      s.once('connect', () => { clearTimeout(timer); resolve(); });
      s.once('connect_error', (err) => { clearTimeout(timer); reject(err); });
    });
  }
  const { bindDdbRollSocket } = await import('@/systems/ddb/bindDdbRollSocket');
  bindDdbRollSocket(true);
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
