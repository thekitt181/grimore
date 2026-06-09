import type { Plugin, ProxyOptions } from 'vite';
import type { ServerResponse } from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

const DEFAULT_SUPERVISOR_URL = 'http://127.0.0.1:3099';
const RESTART_DEBOUNCE_MS = 8000;

let lastRestartRequest = 0;

function isConnectionRefused(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] };
  if (e.code === 'ECONNREFUSED') return true;
  if (Array.isArray(e.errors)) {
    return e.errors.some((nested) => nested?.code === 'ECONNREFUSED');
  }
  return false;
}

async function requestServerRestart(reason: string): Promise<void> {
  const now = Date.now();
  if (now - lastRestartRequest < RESTART_DEBOUNCE_MS) return;
  lastRestartRequest = now;

  const base = process.env['GRIMOIRE_DEV_SUPERVISOR_URL'] ?? DEFAULT_SUPERVISOR_URL;
  try {
    const res = await fetch(`${base}/restart-server`, { method: 'POST' });
    if (res.ok) {
      const body = (await res.json()) as { restarted?: boolean };
      if (body.restarted !== false) {
        console.log(`[vite] Requested API server restart (${reason})`);
      }
      return;
    }
    console.warn(`[vite] Supervisor restart request failed (${res.status})`);
  } catch {
    console.warn(
      '[vite] API server unreachable. Run `pnpm dev` from the repo root so the dev supervisor can restart the server.',
    );
  }
}

type HttpProxy = {
  on(
    event: 'error',
    listener: (err: Error, req: IncomingMessage, res: ServerResponse | Socket) => void,
  ): void;
};

export function attachApiProxySupervisor(proxy: HttpProxy): void {
  proxy.on('error', (err, _req, res) => {
    if (!isConnectionRefused(err)) return;

    void requestServerRestart('ECONNREFUSED');

    // Avoid hanging requests when the upstream is down.
    if (res && 'writeHead' in res && !res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'API server unavailable',
          message: 'The dev supervisor is restarting the API server. Retry in a few seconds.',
        }),
      );
    }
  });
}

function apiProxyTarget(): ProxyOptions {
  return {
    target: 'http://localhost:3001',
    changeOrigin: true,
    configure(proxy) {
      attachApiProxySupervisor(proxy);
    },
  };
}

export function apiProxyConfig(): Record<string, ProxyOptions> {
  return {
    '/api': apiProxyTarget(),
    // Same-origin Socket.io in dev (avoids cross-port WebSocket failures on localhost).
    '/socket.io': {
      ...apiProxyTarget(),
      ws: true,
    },
  };
}

/** Optional plugin hook for future middleware; proxy wiring lives in apiProxyConfig(). */
export function apiProxySupervisorPlugin(): Plugin {
  return {
    name: 'grimoire-api-proxy-supervisor',
  };
}
