import { PrismaClient } from '@prisma/client';
import { resolveAuthDatabaseUrl, resolveDatabaseUrl, resolveReadDatabaseUrl } from './databaseUrl';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  authPrisma?: PrismaClient;
  readPrisma?: PrismaClient;
};

function createClient(url: string): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url } },
    log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
  });
}

/** App data — compendium, sessions, DDB, etc. */
export const prisma =
  globalForPrisma.prisma ?? createClient(resolveDatabaseUrl());

/** Isolated pool for Better Auth so sign-in is not starved by compendium jobs. */
export const authPrisma =
  globalForPrisma.authPrisma ?? createClient(resolveAuthDatabaseUrl());

/** User-facing reads (campaigns, dashboard) — session pooler, not transaction pool. */
export const readPrisma =
  globalForPrisma.readPrisma ?? createClient(resolveReadDatabaseUrl());

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
  globalForPrisma.authPrisma = authPrisma;
  globalForPrisma.readPrisma = readPrisma;
}

export async function connectDatabases(maxAttempts = 6): Promise<void> {
  const timeoutMs = 20_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.race([
        Promise.all([prisma.$connect(), authPrisma.$connect(), readPrisma.$connect()]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`PostgreSQL connect timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      console.log('[DB] PostgreSQL connected (app + auth + read pools)');
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[DB] Connect attempt ${attempt}/${maxAttempts} failed:`, message);
      if (attempt === maxAttempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000 * attempt, 10_000)));
    }
  }
}

export async function disconnectDatabases(): Promise<void> {
  await Promise.all([
    prisma.$disconnect().catch(() => undefined),
    authPrisma.$disconnect().catch(() => undefined),
    readPrisma.$disconnect().catch(() => undefined),
  ]);
}

process.once('beforeExit', () => {
  void disconnectDatabases();
});
if (process.env['NODE_ENV'] !== 'production') {
  process.once('SIGINT', () => { void disconnectDatabases(); });
  process.once('SIGTERM', () => { void disconnectDatabases(); });
}
