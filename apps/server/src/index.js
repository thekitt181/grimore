import 'dotenv/config';
import http from 'http';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { initSocket } from './socket';
import campaignRoutes from './routes/campaigns';
import userRoutes from './routes/users';
import sessionRoutes from './routes/sessions';
import compendiumRoutes from './routes/compendium';
import { closeMongo } from './lib/mongo';
import { syncCompendiumStorageOnStartup } from './services/compendiumGlobal';
import { reconcileRawGlobalStorage } from './services/compendiumOwlbearPersist';
import { warmCompendiumCatalog } from './services/compendiumSync';
import { startCompendiumExternalWatch } from './services/compendiumExternalWatch';
import { startCompendiumMongoWatch } from './services/compendiumMongoWatch';
const app = express();
const httpServer = http.createServer(app);
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const CLIENT_URL = process.env['CLIENT_URL'] ?? 'http://localhost:5173';
// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/campaigns', campaignRoutes);
app.use('/api/users', userRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/compendium', compendiumRoutes);
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
// ─── Socket.io ────────────────────────────────────────────────────────────────
initSocket(httpServer);
// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
    try {
        await prisma.$connect();
        console.log('[DB] PostgreSQL connected');
        await redis.connect();
        // Redis emits its own connect log
        await syncCompendiumStorageOnStartup();
        await reconcileRawGlobalStorage();
        await warmCompendiumCatalog();
        startCompendiumMongoWatch();
        startCompendiumExternalWatch();
        httpServer.listen(PORT, () => {
            console.log(`[Server] GrimoireVTT API running on http://localhost:${PORT}`);
        });
    }
    catch (err) {
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
//# sourceMappingURL=index.js.map