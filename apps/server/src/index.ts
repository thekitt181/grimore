import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/prisma';
import { connectRedisOptional, isRedisOperational, redis } from './lib/redis';
import { attachRedisSocketAdapter } from './lib/socketRedisAdapter';
import { getMongoCircuitStatus, isMongoConfigured } from './lib/mongo';
import { initSocket } from './socket';
import campaignRoutes from './routes/campaigns';
import userRoutes from './routes/users';
import sessionRoutes from './routes/sessions';
import compendiumRoutes from './routes/compendium';
import ddbRoutes from './routes/ddb';
import { closeMongo } from './lib/mongo';
import { getClientOrigins, getPrimaryClientUrl } from './lib/clientOrigins';
import { mountClientSpa } from './lib/serveClient';
import { syncCompendiumStorageOnStartup } from './services/compendiumGlobal';
import { reconcileRawGlobalStorage } from './services/compendiumOwlbearPersist';
import { warmCompendiumCatalog } from './services/compendiumSync';
import { startCompendiumExternalWatch } from './services/compendiumExternalWatch';
import { startCompendiumMongoWatch } from './services/compendiumMongoWatch';

const app = express();
const httpServer = http.createServer(app);

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const clientOrigins = getClientOrigins();

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
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/campaigns', campaignRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/compendium', compendiumRoutes);
app.use('/api/ddb', ddbRoutes);

app.get('/health', (_req, res) => {
  const mongo = getMongoCircuitStatus();
  res.json({
    status: 'ok',
    redis: isRedisOperational() ? 'connected' : 'degraded',
    socketAdapter: process.env['SOCKET_REDIS_ADAPTER'] === '0' ? 'disabled' : 'redis-when-available',
    mongo: isMongoConfigured()
      ? (mongo.open ? 'circuit-open' : 'configured')
      : 'disabled',
    timestamp: new Date().toISOString(),
  });
});

mountClientSpa(app);

// ─── Socket.io ────────────────────────────────────────────────────────────────
const io = initSocket(httpServer);

async function startCompendiumBackground(): Promise<void> {
  try {
    await syncCompendiumStorageOnStartup();
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

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    console.log('[DB] PostgreSQL connected');

    const redisOk = await connectRedisOptional();
    if (!redisOk) {
      console.warn('[Redis] Running without Redis — session caches and DDB dedup are degraded');
    } else {
      await attachRedisSocketAdapter(io);
    }

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

    httpServer.listen(PORT, () => {
      console.log(`[Server] GrimoireVTT API on port ${PORT}`);
      console.log(`[Server] Allowed client origins: ${clientOrigins.join(', ')}`);
      console.log(`[Server] Public app URL (invites): ${getPrimaryClientUrl()}`);
    });

    void startCompendiumBackground();
  } catch (err) {
    console.error('[Server] Startup failed:', err);
    process.exit(1);
  }
}

void start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[Server] Shutting down...');
  await prisma.$disconnect();
  await closeMongo();
  redis.disconnect();
  process.exit(0);
});
