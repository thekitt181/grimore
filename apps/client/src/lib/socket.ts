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
  const dev = import.meta.env.DEV;
  return {
    autoConnect: false,
    // Polling first in dev/mobile — websocket upgrade is optional after connect.
    transports: mobile || dev ? ['polling', 'websocket'] : ['websocket', 'polling'],
    upgrade: !(mobile || dev),
    timeout: mobile ? 90_000 : 45_000,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8_000,
    withCredentials: true,
  };
}

type AuthProvider = () => Promise<string | null>;

let authProvider: AuthProvider | null = null;
let onReconnected: (() => void) | null = null;
let reconnectHooksInstalled = false;

/** Clerk token + re-join hook — survives React effect churn. */
export function configureSocketSession(opts: {
  getAuthToken: AuthProvider;
  onReconnected: () => void;
} | null): void {
  authProvider = opts?.getAuthToken ?? null;
  onReconnected = opts?.onReconnected ?? null;
}

async function refreshSocketAuth(s: Socket, skipCache = true): Promise<boolean> {
  if (!authProvider) return false;
  try {
    const token = await authProvider();
    if (!token) return false;
    s.auth = { token };
    return true;
  } catch (err) {
    console.warn('[Socket] Auth refresh failed:', err);
    return false;
  }
}

function installReconnectHooks(s: Socket): void {
  if (reconnectHooksInstalled) return;
  reconnectHooksInstalled = true;

  s.io.on('reconnect_attempt', () => {
    void refreshSocketAuth(s, true);
  });

  s.io.on('reconnect', () => {
    onReconnected?.();
  });
}

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(getServerOrigin(), socketOptions());
    installReconnectHooks(socket);
  }
  return socket;
}

/** Full teardown (logout / leave app). Preserves listeners during connect retries. */
export function resetSocket(): void {
  if (!socket) return;
  configureSocketSession(null);
  socket.removeAllListeners();
  socket.io.removeAllListeners();
  socket.disconnect();
  socket = null;
  reconnectHooksInstalled = false;
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

/** Reconnect with a fresh Clerk token (fixes stale auth after idle drops). */
export async function reconnectSocketWithFreshAuth(): Promise<void> {
  const s = getSocket();
  const ok = await refreshSocketAuth(s, true);
  if (!ok) throw new Error('Sign-in expired — refresh and try again');
  if (s.connected) {
    s.disconnect();
    await delay(250);
  }
  await new Promise<void>((resolve, reject) => {
    const timeoutMs = isMobileClient() ? 90_000 : 45_000;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Reconnection timed out'));
    }, timeoutMs);
    const onConnect = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const cleanup = () => s.off('connect', onConnect);
    s.once('connect', onConnect);
    s.connect();
  });
}

async function connectSocketOnce(token: string): Promise<void> {
  const s = getSocket();
  s.auth = { token };

  if (s.connected) {
    return;
  }

  if (s.active) {
    s.disconnect();
    await delay(100);
  }

  const timeoutMs = isMobileClient() ? 90_000 : 45_000;

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Connection timed out — server may be waking up'));
    }, timeoutMs);

    const onConnect = () => {
      clearTimeout(timer);
      cleanup();
      resolve();
    };

    const cleanup = () => {
      s.off('connect', onConnect);
    };

    // Do NOT reject on connect_error — Socket.io emits that per transport
    // (e.g. websocket fails) before trying polling. Wait for connect or timeout.
    s.once('connect', onConnect);
    s.connect();
  });

  const { bindDdbRollSocket } = await import('@/systems/ddb/bindDdbRollSocket');
  bindDdbRollSocket(true);
}

export function disconnectSocket(): void {
  resetSocket();
}
