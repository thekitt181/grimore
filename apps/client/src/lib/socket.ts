import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@grimoire/shared';
import { getServerOrigin } from './appUrls';

const SERVER_URL = getServerOrigin();
let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

function preferPollingFirst(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(SERVER_URL, {
      autoConnect: false,
      transports: preferPollingFirst() ? ['polling', 'websocket'] : ['websocket', 'polling'],
      timeout: 20_000,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
    });
  }
  return socket;
}

export async function connectSocket(
  token: string,
  options?: { retries?: number },
): Promise<void> {
  const retries = options?.retries ?? 3;
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await connectSocketOnce(token);
      return;
    } catch (err) {
      lastError = err;
      const s = getSocket();
      if (s.connected) s.disconnect();
      if (attempt < retries - 1) {
        await delay(1000 * (attempt + 1));
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Socket connection failed');
}

async function connectSocketOnce(token: string): Promise<void> {
  const s = getSocket();
  s.auth = { token };

  if (s.connected) {
    const { bindDdbRollSocket } = await import('@/systems/ddb/bindDdbRollSocket');
    bindDdbRollSocket(true);
    return;
  }

  s.connect();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timed out')), 20_000);
    const onConnect = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const onError = (err: Error) => {
      clearTimeout(timer);
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      s.off('connect', onConnect);
      s.off('connect_error', onError);
    };
    s.once('connect', onConnect);
    s.once('connect_error', onError);
  });

  const { bindDdbRollSocket } = await import('@/systems/ddb/bindDdbRollSocket');
  bindDdbRollSocket(true);
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}
