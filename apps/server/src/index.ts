import 'dotenv/config';
import { execSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { connectDatabases, disconnectDatabases, authPrisma, resetPrismaPool } from './lib/prisma';
import { connectRedisOptional, disconnectAllRedis, isRedisOperational } from './lib/redis';
import { attachRedisSocketAdapter, isSocketRedisAdapterEnabled } from './lib/socketRedisAdapter';
import { getCompendiumStorageHealthSnapshot } from './services/compendiumPostgres';
import { initSocket } from './socket';
import campaignRoutes from './routes/campaigns';
import userRoutes from './routes/users';
import sessionRoutes from './routes/sessions';
import sessionMediaRoutes from './routes/sessionMedia';
import compendiumRoutes from './routes/compendium';
import ddbRoutes from './routes/ddb';
import mapsRoutes from './routes/maps';
import artRoutes from './routes/art';
import sceneRoutes from './routes/scenes';
import handoutRoutes from './routes/handouts';
import supportRoutes, { handleSupportWebhook } from './routes/support';
import { getCanonicalClientHostname, getClientOrigins, getPrimaryClientUrl } from './lib/clientOrigins';
import { toNodeHandler } from 'better-auth/node';
import { auth, getAuthBaseUrl, isBetterAuthDashboardEnabled, isGoogleOAuthEnabled } from './lib/auth';
import { scheduleCompendiumJobs } from './services/compendiumStartup';
import { mountClientSpa } from './lib/serveClient';
import { getSessionMediaRoot } from './services/sessionMediaStorage';
import { isFloorplanScanConfigured } from './services/floorplan/floorplanScanService';
import { runMigrationsInBackground } from './lib/runMigrationsInBackground';

import { isDbPoolSaturation, isDbTransientError, withDbTimeout } from './lib/dbTimeout';

async function checkAuthDatabase(): Promise<'ok' | 'error' | 'skipped'> {
  if (!servicesReady) return 'skipped';
  // Render health probes must not compete with auth/API for scarce pool slots.
  if (process.env['RENDER'] === 'true' || process.env['RENDER_SERVICE_ID']) return 'skipped';
  try {
    await withDbTimeout(5_000, () => authPrisma.$queryRaw`SELECT 1`, 'auth health');
    return 'ok';
  } catch (err) {
    console.warn('[Auth] Health DB check failed:', err);
    return 'error';
  }
}

const app = express();
const httpServer = http.createServer(app);

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
/** IPv4 so the Vite proxy can always reach 127.0.0.1:PORT (Windows `localhost` is often ::1). */
const LISTEN_HOST = process.env['HOST'] ?? '0.0.0.0';
const clientOrigins = getClientOrigins();

let servicesReady = false;

if (process.env['TRUST_PROXY'] === '1') {
  app.set('trust proxy', 1);
}

// Canonical host — keep OAuth state cookies on one hostname (www → apex).
app.use((req, res, next) => {
  const canonical = getCanonicalClientHostname();
  if (!canonical) {
    next();
    return;
  }
  const host = req.hostname.toLowerCase();
  if (host === `www.${canonical}`) {
    const proto = req.secure || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
    res.redirect(301, `${proto}://${canonical}${req.originalUrl}`);
    return;
  }
  next();
});

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  referrerPolicy: false,
}));

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin || getClientOrigins().includes(origin)) {
      callback(null, true);
      return;
    }
    if (process.env['NODE_ENV'] !== 'production' && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
};

// CORS only for API — global CORS breaks Vite crossorigin /assets/ (500 + text/html CSS errors).
app.use('/api', cors(corsOptions));
app.use(cookieParser());

const authHandler = toNodeHandler(auth);
app.all('/api/auth/*', (req, res) => {
  if (!servicesReady) {
    res.status(503).json({ error: 'Server is starting — retry shortly', retry: true });
    return;
  }
  void Promise.resolve(authHandler(req, res)).catch(async (err: unknown) => {
    console.error('[Auth] Request failed:', req.method, req.originalUrl, err);
    if (isDbPoolSaturation(err) || isDbTransientError(err)) {
      await resetPrismaPool('auth handler');
      if (!res.headersSent) {
        res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      }
      return;
    }
    if (!res.headersSent) {
      res.status(500).json({ error: 'Authentication service error' });
    }
  });
});
app.post(
  '/api/support/webhook',
  express.raw({ type: 'application/json' }),
  (req, res) => { void handleSupportWebhook(req, res); },
);
app.use(express.json({ limit: '50mb' }));

app.get('/health', async (_req, res) => {
  const compendiumHealth = getCompendiumStorageHealthSnapshot();
  res.json({
    status: servicesReady ? 'ok' : 'starting',
    ready: servicesReady,
    redis: isRedisOperational() ? 'connected' : 'degraded',
    socketAdapter: isSocketRedisAdapterEnabled() ? 'redis-when-available' : 'disabled',
    compendium: compendiumHealth.state,
    compendiumHealth: {
      state: compendiumHealth.state,
      circuitOpen: compendiumHealth.circuitOpen,
      lastCheckedAt: compendiumHealth.lastCheckedAt,
      lastSuccessAt: compendiumHealth.lastSuccessAt,
      lastError: compendiumHealth.lastError,
      latencyMs: compendiumHealth.latencyMs,
    },
    auth: {
      baseUrl: getAuthBaseUrl(),
      googleOAuth: isGoogleOAuthEnabled(),
      googleCallback: `${getAuthBaseUrl()}/api/auth/callback/google`,
      dashboard: isBetterAuthDashboardEnabled(),
    },
    authDb: await checkAuthDatabase(),
    timestamp: new Date().toISOString(),
  });
});

const sessionMediaRoot = getSessionMediaRoot();
fs.mkdirSync(sessionMediaRoot, { recursive: true });
app.use('/api/session-media', express.static(sessionMediaRoot, {
  maxAge: '7d',
  setHeaders(res, filePath) {
    if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(filePath)) {
      res.setHeader('Accept-Ranges', 'bytes');
    }
  },
}));

app.use('/api', (req, res, next) => {
  if (!servicesReady) {
    res.status(503).json({ error: 'Server is starting — retry shortly', retry: true });
    return;
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/campaigns', campaignRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/sessions', sessionMediaRoutes);
app.use('/api/compendium', compendiumRoutes);
app.use('/api/ddb', ddbRoutes);
app.use('/api/maps', mapsRoutes);
app.use('/api/art', artRoutes);
app.use('/api/scenes', sceneRoutes);
app.use('/api/handouts', handoutRoutes);
app.use('/api/support', supportRoutes);
mountClientSpa(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = initSocket(httpServer);

async function connectRedisInBackground(): Promise<void> {
  let redisOk = false;
  try {
    redisOk = await connectRedisOptional();
  } catch (err) {
    console.warn('[Redis] Startup error — continuing without Redis:', err);
  }
  if (!redisOk) {
    console.warn('[Redis] Running without Redis — session caches and DDB dedup are degraded');
    return;
  }
  if (isSocketRedisAdapterEnabled()) {
    await attachRedisSocketAdapter(io);
  } else {
    console.log('[Socket] Single-instance mode (no Redis socket adapter)');
  }
}

async function bootServices(): Promise<void> {
  try {
    await connectDatabases();

    // API routes need Postgres only — don't block on Redis, compendium, or DDB jobs.
    servicesReady = true;
    console.log('[Server] API ready');
    if (isFloorplanScanConfigured()) {
      console.log('[Floorplan] CubiCasa UNet scan available');
    } else {
      console.log('[Floorplan] CV wall scan only (run pnpm floorplan:weights + pip install -e services/floorplan-scan for AI doors)');
    }

    void connectRedisInBackground();
    scheduleCompendiumJobs();
    scheduleResumeImportJobs();

    // Stale import cleanup can hold a DB connection for 60s+ when Supabase is saturated;
    // withDbTimeout does not cancel the underlying Prisma query. Skip on Render.
    const isRender = process.env['RENDER'] === 'true' || Boolean(process.env['RENDER_SERVICE_ID']);
    if (!isRender) {
      void import('./services/ddb/ddbImportJobService')
        .then(({ releaseStaleImportJobsOnStartup }) =>
          withDbTimeout(8_000, releaseStaleImportJobsOnStartup, 'ddb.stale-import-cleanup'),
        )
        .catch((err) => {
          console.warn('[DDB] Stale import job cleanup skipped:', err);
        });
    }
  } catch (err) {
    console.error('[Server] Service boot failed — API stays unavailable until DB connects:', err);
  }
}

/** Defer DDB import resume so auth/API aren't starved by pool checkout at cold start. */
function scheduleResumeImportJobs(): void {
  const isRender = process.env['RENDER'] === 'true' || Boolean(process.env['RENDER_SERVICE_ID']);
  if (isRender && process.env['DDB_RESUME_IMPORT_JOBS'] !== '1') {
    console.log('[DDB] Auto-resume of import jobs disabled on Render (set DDB_RESUME_IMPORT_JOBS=1 to enable)');
    return;
  }
  const defaultDelay = isRender ? 600_000 : 120_000;
  const delayMs = Number(process.env['DDB_RESUME_JOBS_DELAY_MS'] ?? defaultDelay);
  setTimeout(() => {
    void import('./services/ddb/ddbImportJobService')
      .then(({ resumeRunningImportJobs }) => resumeRunningImportJobs())
      .catch((err) => {
        console.warn('[DDB] Could not resume import jobs:', err);
      });
  }, delayMs);
}

function isRenderHost(): boolean {
  return process.env['RENDER'] === 'true' || Boolean(process.env['RENDER_SERVICE_ID']);
}

function pidsListeningOn(port: number): number[] {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: 'utf8',
        shell: true,
      });
      const pids = new Set<number>();
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        const parts = line.trim().split(/\s+/);
        const local = parts[1] ?? '';
        const bound = local.includes(']:')
          ? local.slice(local.lastIndexOf(']:') + 2)
          : local.slice(local.lastIndexOf(':') + 1);
        if (Number(bound) !== port) continue;
        const pid = Number(parts[parts.length - 1]);
        if (Number.isFinite(pid) && pid > 0) pids.add(pid);
      }
      return [...pids];
    }
    const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' });
    return out
      .split(/\s+/)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

async function portHasHealthyApi(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1200) });
    if (!res.ok) return false;
    const data = (await res.json()) as { ready?: boolean };
    return data.ready === true;
  } catch {
    return false;
  }
}

function freeDevPort(port: number): void {
  const self = process.pid;
  for (const pid of pidsListeningOn(port)) {
    if (pid === self) continue;
    try {
      if (process.platform === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', shell: true });
      } else {
        process.kill(pid, 'SIGKILL');
      }
      console.warn(`[Server] Freed port ${port} (killed pid ${pid})`);
    } catch {
      /* best effort */
    }
  }
}

function start() {
  let listenAttempts = 0;
  let listenRetry: ReturnType<typeof setTimeout> | null = null;
  const MAX_LISTEN_ATTEMPTS = 6;

  const tryListen = () => {
    if (httpServer.listening) return;
    httpServer.listen(PORT, LISTEN_HOST);
  };

  const scheduleListenRetry = (delayMs: number) => {
    if (listenRetry || httpServer.listening) return;
    listenRetry = setTimeout(() => {
      listenRetry = null;
      tryListen();
    }, delayMs);
  };

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    void (async () => {
      if (err.code === 'EADDRINUSE') {
        if (httpServer.listening) return;
        listenAttempts += 1;
        if (isRenderHost()) {
          if (listenAttempts < MAX_LISTEN_ATTEMPTS) {
            console.warn(
              `[Server] Port ${PORT} is in use — retrying in 2s (${listenAttempts}/${MAX_LISTEN_ATTEMPTS})…`,
            );
            scheduleListenRetry(2000);
            return;
          }
          console.error(
            `[Server] Port ${PORT} is still in use after ${MAX_LISTEN_ATTEMPTS} attempts.`,
          );
          process.exit(1);
          return;
        }
        if (await portHasHealthyApi(PORT)) {
          console.warn(`[Server] Port ${PORT} already has a healthy API — not killing it`);
          scheduleListenRetry(5000);
          return;
        }
        if (listenAttempts === 1 || listenAttempts % 4 === 0) {
          freeDevPort(PORT);
        }
        console.warn(`[Server] Port ${PORT} is in use — waiting to bind (${listenAttempts})…`);
        scheduleListenRetry(1000);
        return;
      }
      console.error('[Server] HTTP error:', err);
      process.exit(1);
    })();
  });

  httpServer.keepAliveTimeout = 120_000;
  httpServer.headersTimeout = 125_000;

  httpServer.listen(PORT, LISTEN_HOST, () => {
    if (listenRetry) {
      clearTimeout(listenRetry);
      listenRetry = null;
    }
    listenAttempts = 0;
    console.log(`[Server] GrimoireVTT listening on ${LISTEN_HOST}:${PORT}`);
    console.log(`[Server] Allowed client origins: ${clientOrigins.join(', ')}`);
    console.log(`[Server] Public app URL (invites): ${getPrimaryClientUrl()}`);
    if (process.env['NODE_ENV'] === 'production') {
      runMigrationsInBackground();
    }
    void bootServices();
  });
}

start();

process.on('unhandledRejection', (reason) => {
  console.error('[Server] Unhandled promise rejection (keeping process alive):', reason);
});

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  servicesReady = false;
  await disconnectDatabases();
  disconnectAllRedis();
  process.exit(0);
});
