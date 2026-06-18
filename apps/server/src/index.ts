import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { connectDatabases, disconnectDatabases, authPrisma } from './lib/prisma';
import { connectRedisOptional, disconnectAllRedis, isRedisOperational } from './lib/redis';
import { attachRedisSocketAdapter, isSocketRedisAdapterEnabled } from './lib/socketRedisAdapter';
import { getCompendiumStorageHealthSnapshot } from './services/compendiumPostgres';
import { initSocket } from './socket';
import campaignRoutes from './routes/campaigns';
import userRoutes from './routes/users';
import sessionRoutes from './routes/sessions';
import compendiumRoutes from './routes/compendium';
import ddbRoutes from './routes/ddb';
import mapsRoutes from './routes/maps';
import sceneRoutes from './routes/scenes';
import handoutRoutes from './routes/handouts';
import supportRoutes, { handleSupportWebhook } from './routes/support';
import { getCanonicalClientHostname, getClientOrigins, getPrimaryClientUrl } from './lib/clientOrigins';
import { toNodeHandler } from 'better-auth/node';
import { auth, getAuthBaseUrl, isBetterAuthDashboardEnabled, isGoogleOAuthEnabled } from './lib/auth';
import { scheduleCompendiumJobs } from './services/compendiumStartup';
import { mountClientSpa } from './lib/serveClient';
import { isFloorplanScanConfigured } from './services/floorplan/floorplanScanService';
import { runMigrationsInBackground } from './lib/runMigrationsInBackground';

import { withDbTimeout } from './lib/dbTimeout';

async function checkAuthDatabase(): Promise<'ok' | 'error' | 'skipped'> {
  if (!servicesReady) return 'skipped';
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
  crossOriginResourcePolicy: false,
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
  void Promise.resolve(authHandler(req, res)).catch((err: unknown) => {
    console.error('[Auth] Request failed:', req.method, req.originalUrl, err);
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

app.use('/api', (req, res, next) => {
  if (!servicesReady) {
    res.status(503).json({ error: 'Server is starting — retry shortly' });
    return;
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/campaigns', campaignRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/compendium', compendiumRoutes);
app.use('/api/ddb', ddbRoutes);
app.use('/api/maps', mapsRoutes);
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

    // Non-blocking — Supavisor can take up to 60s to fail when Postgres is saturated.
    void import('./services/ddb/ddbImportJobService')
      .then(({ releaseStaleImportJobsOnStartup }) =>
        withDbTimeout(8_000, releaseStaleImportJobsOnStartup, 'ddb.stale-import-cleanup'),
      )
      .catch((err) => {
        console.warn('[DDB] Stale import job cleanup skipped:', err);
      });
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

function start() {
  let listenAttempts = 0;
  const MAX_LISTEN_ATTEMPTS = 6;

  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && listenAttempts < MAX_LISTEN_ATTEMPTS) {
      listenAttempts += 1;
      console.warn(
        `[Server] Port ${PORT} is in use — retrying in 2s (${listenAttempts}/${MAX_LISTEN_ATTEMPTS})…`,
      );
      setTimeout(() => {
        httpServer.listen(PORT);
      }, 2000);
      return;
    }
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Server] Port ${PORT} is still in use after ${MAX_LISTEN_ATTEMPTS} attempts. Run: pnpm dev:kill-ports`,
      );
      process.exit(1);
    }
    console.error('[Server] HTTP error:', err);
    process.exit(1);
  });

  httpServer.keepAliveTimeout = 120_000;
  httpServer.headersTimeout = 125_000;

  httpServer.listen(PORT, () => {
    listenAttempts = 0;
    console.log(`[Server] GrimoireVTT listening on port ${PORT}`);
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
