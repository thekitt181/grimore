import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/prisma';
import { connectRedisOptional, disconnectAllRedis, isRedisOperational } from './lib/redis';
import { attachRedisSocketAdapter, isSocketRedisAdapterEnabled } from './lib/socketRedisAdapter';
import { getMongoCircuitStatus, isMongoConfigured } from './lib/mongo';
import { initSocket } from './socket';
import campaignRoutes from './routes/campaigns';
import userRoutes from './routes/users';
import sessionRoutes from './routes/sessions';
import compendiumRoutes from './routes/compendium';
import ddbRoutes from './routes/ddb';
import { closeMongo } from './lib/mongo';
import { getClientOrigins, getPrimaryClientUrl } from './lib/clientOrigins';
import { toNodeHandler } from 'better-auth/node';
import { auth, getAuthBaseUrl, isGoogleOAuthEnabled } from './lib/auth';
import { startCompendiumMongoWatch } from './services/compendiumMongoWatch';
import { syncCompendiumStorageOnStartup } from './services/compendiumGlobal';
import { reconcileRawGlobalStorage } from './services/compendiumOwlbearPersist';
import { warmCompendiumCatalog } from './services/compendiumSync';
import { startCompendiumExternalWatch } from './services/compendiumExternalWatch';
import { mountClientSpa } from './lib/serveClient';

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
  const mongo = getMongoCircuitStatus();
  res.json({
    status: servicesReady ? 'ok' : 'starting',
    ready: servicesReady,
    redis: isRedisOperational() ? 'connected' : 'degraded',
    socketAdapter: isSocketRedisAdapterEnabled() ? 'redis-when-available' : 'disabled',
    mongo: isMongoConfigured()
      ? (mongo.open ? 'circuit-open' : 'configured')
      : 'disabled',
    auth: {
      baseUrl: getAuthBaseUrl(),
      googleOAuth: isGoogleOAuthEnabled(),
      googleCallback: `${getAuthBaseUrl()}/api/auth/callback/google`,
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

mountClientSpa(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = initSocket(httpServer);

async function startCompendiumBackground(): Promise<void> {
  try {
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

async function bootServices(): Promise<void> {
  try {
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');

    let redisOk = false;
    try {
      redisOk = await connectRedisOptional();
    } catch (err) {
      console.warn('[Redis] Startup error — continuing without Redis:', err);
    }
    if (!redisOk) {
      console.warn('[Redis] Running without Redis — session caches and DDB dedup are degraded');
    } else if (isSocketRedisAdapterEnabled()) {
      await attachRedisSocketAdapter(io);
    } else {
      console.log('[Socket] Single-instance mode (no Redis socket adapter)');
    }

    servicesReady = true;
    console.log('[Server] API ready');
    void startCompendiumBackground();
    try {
      const { resumeRunningImportJobs } = await import('./services/ddb/ddbImportJobService');
      void resumeRunningImportJobs();
    } catch (err) {
      console.warn('[DDB] Could not resume import jobs:', err);
    }
  } catch (err) {
    console.error('[Server] Service boot failed:', err);
  }
}

function start() {
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `[Server] Port ${PORT} is already in use. Stop the other process (or run: Get-NetTCPConnection -LocalPort ${PORT} | Stop-Process -Id {OwningProcess})`,
      );
      process.exit(1);
    }
    console.error('[Server] HTTP error:', err);
    process.exit(1);
  });

  httpServer.keepAliveTimeout = 120_000;
  httpServer.headersTimeout = 125_000;

  httpServer.listen(PORT, () => {
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
