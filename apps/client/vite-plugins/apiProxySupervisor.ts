import type { Plugin, ProxyOptions } from 'vite';
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

const API_HOST = '127.0.0.1';
const API_PORT = Number(process.env['GRIMOIRE_API_PORT'] ?? 3001);
const SUPERVISOR_URL = process.env['GRIMOIRE_DEV_SUPERVISOR_URL'] ?? 'http://127.0.0.1:3099';
const RETRY_DELAYS_MS = [150, 250, 400, 600, 800, 1100, 1500, 2000, 2500, 3500];
const RESTART_COOLDOWN_MS = 20_000;
const MAX_BUFFER_BYTES = 5 * 1024 * 1024;

let lastRestartRequest = 0;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionBlip(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as NodeJS.ErrnoException & { errors?: NodeJS.ErrnoException[] };
  const codes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH']);
  if (e.code && codes.has(e.code)) return true;
  if (Array.isArray(e.errors)) {
    return e.errors.some((nested) => nested?.code && codes.has(nested.code));
  }
  return false;
}

async function apiHealthOk(): Promise<boolean> {
  try {
    const res = await fetch(`http://${API_HOST}:${API_PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function supervisorHealthOk(): Promise<boolean> {
  try {
    const res = await fetch(`${SUPERVISOR_URL}/health`, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function requestServerRestart(reason: string): Promise<void> {
  const now = Date.now();
  if (now - lastRestartRequest < RESTART_COOLDOWN_MS) return;
  if (await apiHealthOk()) return;
  if (!(await supervisorHealthOk())) {
    console.warn(
      `[vite] API ${API_HOST}:${API_PORT} is down (${reason}). Start it with pnpm --filter @grimoire/server dev — no supervisor on 3099.`,
    );
    return;
  }
  lastRestartRequest = now;
  try {
    const res = await fetch(`${SUPERVISOR_URL}/restart-server`, { method: 'POST' });
    if (res.ok) {
      console.log(`[vite] Asked supervisor to restart API (${reason})`);
    }
  } catch {
    /* supervisor gone between health and POST */
  }
}

function collectBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BUFFER_BYTES) {
        reject(new Error('body too large to buffer for retry'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function stripHopByHop(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = { ...headers };
  delete out.connection;
  delete out['keep-alive'];
  delete out['proxy-connection'];
  delete out['transfer-encoding'];
  delete out.te;
  delete out.trailer;
  delete out.upgrade;
  return out;
}

function isRetryableApiStatus(status: number, bodyText: string): boolean {
  if (status !== 502 && status !== 503 && status !== 504) return false;
  if (status === 504 || status === 502) return true;
  try {
    const json = JSON.parse(bodyText) as { retry?: boolean; error?: string; message?: string };
    if (json.retry === true) return true;
    return /starting|busy|unavailable|retry/i.test(`${json.error ?? ''} ${json.message ?? ''}`);
  } catch {
    return true;
  }
}

function tryProxyOnce(
  req: IncomingMessage,
  res: ServerResponse,
  body: Buffer | null,
): Promise<'ok' | 'blip' | 'fail'> {
  return new Promise((resolve) => {
    const headers = stripHopByHop(req.headers);
    headers.host = `${API_HOST}:${API_PORT}`;
    delete headers['accept-encoding'];
    if (body) headers['content-length'] = body.length;
    const pReq = http.request(
      {
        hostname: API_HOST,
        port: API_PORT,
        path: req.url,
        method: req.method,
        headers,
        timeout: 30_000,
      },
      (pRes) => {
        const status = pRes.statusCode ?? 502;
        if (status === 502 || status === 503 || status === 504) {
          const chunks: Buffer[] = [];
          pRes.on('data', (chunk: Buffer) => chunks.push(chunk));
          pRes.on('error', () => resolve('fail'));
          pRes.on('end', () => {
            const payload = Buffer.concat(chunks);
            const text = payload.toString('utf8');
            if (isRetryableApiStatus(status, text)) {
              resolve('blip');
              return;
            }
            if (!res.headersSent) {
              res.writeHead(status, stripHopByHop(pRes.headers));
              res.end(payload);
            }
            resolve('ok');
          });
          return;
        }
        res.writeHead(status, stripHopByHop(pRes.headers));
        pRes.pipe(res);
        pRes.on('end', () => resolve('ok'));
        pRes.on('error', () => resolve('fail'));
      },
    );
    pReq.on('error', (err) => {
      resolve(isConnectionBlip(err) ? 'blip' : 'fail');
    });
    pReq.on('timeout', () => {
      pReq.destroy();
      resolve('blip');
    });
    if (body && body.length > 0) pReq.end(body);
    else if (body) pReq.end();
    else req.pipe(pReq);
  });
}

async function proxyApiWithRetry(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let body: Buffer | null = Buffer.alloc(0);
  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    try {
      body = await collectBody(req);
    } catch {
      body = null;
    }
  }

  for (let i = 0; i <= RETRY_DELAYS_MS.length; i += 1) {
    const result = await tryProxyOnce(req, res, body);
    if (result === 'ok') return;
    if (result === 'fail') break;
    if (res.headersSent) return;
    if (i < RETRY_DELAYS_MS.length) {
      await delay(RETRY_DELAYS_MS[i]!);
    }
  }

  await requestServerRestart('proxy retries exhausted');
  if (!res.headersSent) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: 'API server unavailable',
        message: 'Waiting for the local API on port 3001. It should come up in a few seconds.',
      }),
    );
  }
}

type HttpProxy = {
  on(
    event: 'error',
    listener: (err: Error, req: IncomingMessage, res: ServerResponse | Socket) => void,
  ): void;
};

/** Socket.io proxy only — HTTP /api is retried in the plugin middleware. */
export function attachApiProxySupervisor(proxy: HttpProxy): void {
  proxy.on('error', (err, _req, res) => {
    if (!isConnectionBlip(err)) return;
    void requestServerRestart('socket proxy blip');
    if (res && 'writeHead' in res && !res.headersSent) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'API server unavailable' }));
    }
  });
}

function socketProxyTarget(): ProxyOptions {
  return {
    target: `http://${API_HOST}:${API_PORT}`,
    changeOrigin: true,
    ws: true,
    configure(proxy) {
      attachApiProxySupervisor(proxy);
    },
  };
}

export function apiProxyConfig(): Record<string, ProxyOptions> {
  return {
    '/socket.io': socketProxyTarget(),
  };
}

export function apiProxySupervisorPlugin(): Plugin {
  return {
    name: 'grimoire-api-proxy-supervisor',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api')) {
          next();
          return;
        }
        void proxyApiWithRetry(req, res).catch((err) => {
          console.warn('[vite] API proxy failed:', err);
          if (!res.headersSent) {
            res.statusCode = 502;
            res.end();
          }
        });
      });
    },
  };
}
