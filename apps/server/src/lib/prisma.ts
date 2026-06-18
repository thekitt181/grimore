import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from './databaseUrl';
import { isDbPoolSaturation } from './dbTimeout';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

let resetInFlight: Promise<void> | null = null;
let lastResetAt = 0;
const RESET_COOLDOWN_MS = 3_000;

/** Serialize Prisma queries so concurrent requests cannot exhaust connection_limit. */
let dbTail: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const job = dbTail.then(fn, fn);
  dbTail = job.catch(() => undefined);
  return job;
}

/** Drop stuck connections when the pool is saturated (withDbTimeout orphans, P2024, etc.). */
export async function resetPrismaPool(reason = 'unknown'): Promise<void> {
  const now = Date.now();
  if (resetInFlight) return resetInFlight;
  if (now - lastResetAt < RESET_COOLDOWN_MS) return;
  lastResetAt = now;

  resetInFlight = (async () => {
    console.warn(`[DB] Resetting Prisma pool (${reason})`);
    await prisma.$disconnect().catch(() => undefined);
    await prisma.$connect().catch((err) => {
      console.warn('[DB] Pool reconnect failed:', err);
    });
  })().finally(() => {
    resetInFlight = null;
  });

  return resetInFlight;
}

function createClient(): PrismaClient {
  const base = new PrismaClient({
    datasources: { db: { url: resolveDatabaseUrl() } },
    log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
  });

  const extended = base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          return runSerialized(async () => {
            try {
              return await query(args);
            } catch (err) {
              if (isDbPoolSaturation(err)) {
                await resetPrismaPool('query saturation');
                return await query(args);
              }
              throw err;
            }
          });
        },
      },
    },
  });

  return extended as unknown as PrismaClient;
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
