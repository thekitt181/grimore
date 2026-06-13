import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/prisma';
import { connectRedisOptional, disconnectAllRedis, isRedisOperational } from './lib/redis';
import { attachRedisSocketAdapter, isSocketRedisAdapterEnabled } from './lib/socketRedisAdapter';
import { getMongoHealthSnapshot, isMongoConfigured, startMongoHealthProbe } from './lib/mongo';
import { initSocket } from './socket';
import campaignRoutes from './routes/campaigns';
import userRoutes from './routes/users';
import sessionRoutes from './routes/sessions';
import compendiumRoutes from './routes/compendium';
import ddbRoutes from './routes/ddb';
import mapsRoutes from './routes/maps';
import { closeMongo } from './lib/mongo';
import { getClientOrigins, getPrimaryClientUrl } from './lib/clientOrigins';
import { toNodeHandler } from 'better-auth/node';
import { auth, getAuthBaseUrl, isBetterAuthDashboardEnabled, isGoogleOAuthEnabled } from './lib/auth';
import { startCompendiumMongoWatch } from './services/compendiumMongoWatch';
import { syncCompendiumStorageOnStartup } from './services/compendiumGlobal';
import { reconcileRawGlobalStorage } from './services/compendiumOwlbearPersist';
import { warmCompendiumCatalog } from './services/compendiumSync';
import { startCompendiumExternalWatch } from './services/compendiumExternalWatch';
import { mountClientSpa } from './lib/serveClient';
import { isFloorplanScanConfigured } from './services/floorplan/floorplanScanService';

const app = express();
const httpServer = http.createServer(app);

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const clientOrigins = getClientOrigins();

let servicesReady = false;

if (process.env['TRUST_PROXY'] === '1') {
  app.set('trust proxy', 1);
}

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || clientOrigins.includes(origin)) {
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
}));
app.use(cookieParser());
app.all('/api/auth/*', toNodeHandler(auth));
app.use(express.json({ limit: '50mb' }));

app.get('/health', (_req, res) => {
  const mongoHealth = getMongoHealthSnapshot();
  res.json({
    status: servicesReady ? 'ok' : 'starting',
    ready: servicesReady,
    redis: isRedisOperational() ? 'connected' : 'degraded',
    socketAdapter: isSocketRedisAdapterEnabled() ? 'redis-when-available' : 'disabled',
    mongo: isMongoConfigured() ? mongoHealth.state : 'disabled',
    mongoHealth: isMongoConfigured()
      ? {
          state: mongoHealth.state,
          circuitOpen: mongoHealth.circuitOpen,
          lastCheckedAt: mongoHealth.lastCheckedAt,
          lastSuccessAt: mongoHealth.lastSuccessAt,
          lastError: mongoHealth.lastError,
          latencyMs: mongoHealth.latencyMs,
        }
      : undefined,
    auth: {
      baseUrl: getAuthBaseUrl(),
      googleOAuth: isGoogleOAuthEnabled(),
      googleCallback: `${getAuthBaseUrl()}/api/auth/callback/google`,
      dashboard: isBetterAuthDashboardEnabled(),
    },
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

mountClientSpa(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = initSocket(httpServer);

async function startCompendiumBackground(): Promise<void> {
  try {
    const { warmBookSourcesCacheFromDisk } = await import('./services/compendiumBookSourcesCache');
    warmBookSourcesCacheFromDisk();
    startMongoHealthProbe(Number(process.env['MONGO_HEALTH_INTERVAL_MS'] ?? 20_000));
    await syncCompendiumStorageOnStartup();
    const { ensureBundledSourcesLocked, ensureImportedSourcesUnlocked } = await import('./services/compendiumBundledLock');
    await ensureBundledSourcesLocked('startup');
    await ensureImportedSourcesUnlocked('startup');
    await warmCompendiumCatalog();
    startCompendiumMongoWatch();
    if (process.env['COMPENDIUM_MONGO_ONLY'] !== '1') {
      startCompendiumExternalWatch();
    } else {
      console.log('[Compendium] Mongo-only mode — extension sync disabled');
    }
  } catch (err) {
    console.error('[Compendium] Background init failed:', err);
  }
  void reconcileRawGlobalStorage();
}

async function connectDatabase(maxAttempts = 6): Promise<void> {
  const timeoutMs = 20_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.race([
        prisma.$connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`PostgreSQL connect timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      console.log('[DB] PostgreSQL connected');
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[DB] Connect attempt ${attempt}/${maxAttempts} failed:`, message);
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000 * attempt, 10_000)));
    }
  }
}

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
    await connectDatabase();

    // API routes need Postgres only — don't block on Redis, compendium, or DDB jobs.
    servicesReady = true;
    console.log('[Server] API ready');
    if (isFloorplanScanConfigured()) {
      console.log('[Floorplan] CubiCasa UNet scan available');
    } else {
      console.log('[Floorplan] CV wall scan only (run pnpm floorplan:weights + pip install -e services/floorplan-scan for AI doors)');
    }

    void connectRedisInBackground();
    void startCompendiumBackground();
    try {
      const { resumeRunningImportJobs } = await import('./services/ddb/ddbImportJobService');
      void resumeRunningImportJobs();
    } catch (err) {
      console.warn('[DDB] Could not resume import jobs:', err);
    }
  } catch (err) {
    console.error('[Server] Service boot failed — API stays unavailable until DB connects:', err);
  }
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
    void bootServices();
  });
}

start();

process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  servicesReady = false;
  await prisma.$disconnect();
  await closeMongo();
  disconnectAllRedis();
  process.exit(0);
});
