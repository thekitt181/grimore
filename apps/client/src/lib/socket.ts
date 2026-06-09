import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@grimoire/shared';
import { getServerOrigin } from './appUrls';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function isMobileClient(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod|Android|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function socketOptions() {
  const mobile = isMobileClient();
  return {
    autoConnect: false,
    // Mobile networks + Render cold starts: polling-only is far more reliable.
    transports: mobile ? ['polling'] : ['websocket', 'polling'],
    upgrade: !mobile,
    timeout: mobile ? 45_000 : 25_000,
    reconnection: true,
    reconnectionAttempts: 12,
    reconnectionDelay: 1500,
    reconnectionDelayMax: 10_000,
    withCredentials: true,
  };
}

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(getServerOrigin(), socketOptions());
  }
  return socket;
}

/** Full teardown (logout / leave app). Preserves listeners during connect retries. */
export function resetSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

function softDisconnect(): void {
  if (!socket) return;
  socket.disconnect();
}

export async function connectSocket(
  token: string,
  options?: { retries?: number },
): Promise<void> {
  const retries = options?.retries ?? (isMobileClient() ? 6 : 3);
  let lastError: unknown;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await connectSocketOnce(token);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`[Socket] connect attempt ${attempt + 1}/${retries} failed:`, err);
      softDisconnect();
      if (attempt < retries - 1) {
        await delay(isMobileClient() ? 2000 * (attempt + 1) : 1000 * (attempt + 1));
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

  if (s.active) {
    s.disconnect();
    await delay(100);
  }

  s.connect();

  const timeoutMs = isMobileClient() ? 45_000 : 25_000;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Connection timed out — server may be waking up')), timeoutMs);
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
  resetSocket();
}
