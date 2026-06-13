import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from './databaseUrl';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: {
      db: { url: resolveDatabaseUrl() },
    },
    log: process.env['NODE_ENV'] === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env['NODE_ENV'] !== 'production') {
  globalForPrisma.prisma = prisma;
}

function disconnectPrisma(): void {
  void prisma.$disconnect().catch(() => {
    /* ignore */
  });
}

process.once('beforeExit', disconnectPrisma);
if (process.env['NODE_ENV'] !== 'production') {
  process.once('SIGINT', disconnectPrisma);
  process.once('SIGTERM', disconnectPrisma);
}
