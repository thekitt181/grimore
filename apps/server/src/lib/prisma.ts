import { PrismaClient } from '@prisma/client';
import { resolveAuthDatabaseUrl, resolveDatabaseUrl } from './databaseUrl';
import { isDbPoolSaturation } from './dbTimeout';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  authPrisma?: PrismaClient;
};

let resetInFlight: Promise<void> | null = null;
let lastResetAt = 0;
const RESET_COOLDOWN_MS = 3_000;

/** Serialize non-auth Prisma queries so concurrent requests cannot exhaust connection_limit. */
let dbTail: Promise<unknown> = Promise.resolve();

function runSerialized<T>(fn: () => Promise<T>): Promise<T> {
  const job = dbTail.then(fn, fn);
  dbTail = job.catch(() => undefined);
  return job;
}

function wrapWithSaturationRetry(client: PrismaClient, onSaturation: () => Promise<void>): PrismaClient {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          try {
            return await query(args);
          } catch (err) {
            if (isDbPoolSaturation(err)) {
              await onSaturation();
              return await query(args);
            }
            throw err;
          }
        },
      },
    },
  }) as unknown as PrismaClient;
}

/** Drop stuck connections when the pool is saturated (withDbTimeout orphans, P2024, etc.). */
export async function resetPrismaPool(reason = 'unknown'): Promise<void> {
  const now = Date.now();
  if (resetInFlight) return resetInFlight;
  if (now - lastResetAt < RESET_COOLDOWN_MS) return;
  lastResetAt = now;

  resetInFlight = (async () => {
    console.warn(`[DB] Resetting Prisma pools (${reason})`);
    await Promise.all([
      prisma.$disconnect().catch(() => undefined),
      authPrisma.$disconnect().catch(() => undefined),
    ]);
    await Promise.all([
      prisma.$connect().catch((err) => {
        console.warn('[DB] App pool reconnect failed:', err);
      }),
      authPrisma.$connect().catch((err) => {
        console.warn('[DB] Auth pool reconnect failed:', err);
      }),
    ]);
  })().finally(() => {
    resetInFlight = null;
  });

  return resetInFlight;
}

function createAppClient(): PrismaClient {
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

function createAuthClient(): PrismaClient {
  const base = new PrismaClient({
    datasources: { db: { url: resolveAuthDatabaseUrl() } },
    log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
  });
  return wrapWithSaturationRetry(base, () => resetPrismaPool('auth query saturation'));
}

/**
 * App pool — campaigns, compendium, DDB (serialized to protect connection_limit).
 * Auth pool — Better Auth only (own connection slot, never queued behind compendium).
 */
export const authPrisma = globalForPrisma.authPrisma ?? createAuthClient();
export const prisma = globalForPrisma.prisma ?? createAppClient();

/** @deprecated Alias — use `prisma`. Kept so imports do not need a wide refactor. */
export const readPrisma = prisma;

globalForPrisma.authPrisma = authPrisma;
globalForPrisma.prisma = prisma;

export async function connectDatabases(maxAttempts = 6): Promise<void> {
  const timeoutMs = 20_000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await Promise.race([
        Promise.all([prisma.$connect(), authPrisma.$connect()]),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`PostgreSQL connect timeout after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      console.log('[DB] PostgreSQL connected (app + auth pools)');
      try {
        const u = new URL(resolveDatabaseUrl());
        console.log(
          `[DB] App pool: port=${u.port || '5432'} pgbouncer=${u.searchParams.get('pgbouncer') ?? 'false'} `
          + `connection_limit=${u.searchParams.get('connection_limit') ?? 'default'} `
          + `pool_timeout=${u.searchParams.get('pool_timeout') ?? 'default'}s`,
        );
        const au = new URL(resolveAuthDatabaseUrl());
        console.log(
          `[DB] Auth pool: connection_limit=${au.searchParams.get('connection_limit') ?? 'default'}`,
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
  await Promise.all([
    prisma.$disconnect().catch(() => undefined),
    authPrisma.$disconnect().catch(() => undefined),
  ]);
}

process.once('beforeExit', () => {
  void disconnectDatabases();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void disconnectDatabases();
  });
}
