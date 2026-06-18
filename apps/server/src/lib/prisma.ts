import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from './databaseUrl';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};
function createClient(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
    log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
  });
}

/**
 * Single shared Prisma pool for the whole server (auth, campaigns, compendium, DDB).
 * Multiple PrismaClient instances each reserve their own connection_limit slots against
 * Supabase's pooler and caused EMAXCONNSESSION / ECHECKOUTTIMEOUT under load.
 */
export const prisma = globalForPrisma.prisma ?? createClient();

/** @deprecated Alias — use `prisma`. Kept so imports do not need a wide refactor. */
export const authPrisma = prisma;

/** @deprecated Alias — use `prisma`. Kept so imports do not need a wide refactor. */
export const readPrisma = prisma;

globalForPrisma.prisma = prisma;

export async function connectDatabases(maxAttempts = 6): Promise<void> {
  const timeoutMs = 20_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.race([
        prisma.$connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`PostgreSQL connect timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      console.log('[DB] PostgreSQL connected (shared pool)');
      try {
        const u = new URL(resolveDatabaseUrl());
        console.log(
          `[DB] Pool settings: port=${u.port || '5432'} pgbouncer=${u.searchParams.get('pgbouncer') ?? 'false'} `
          + `connection_limit=${u.searchParams.get('connection_limit') ?? 'default'} `
          + `pool_timeout=${u.searchParams.get('pool_timeout') ?? 'default'}s`,
        );
      } catch {
        /* ignore */
      }
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
  await prisma.$disconnect().catch(() => undefined);
}

process.once('beforeExit', () => {
  void disconnectDatabases();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void disconnectDatabases();
  });
}
