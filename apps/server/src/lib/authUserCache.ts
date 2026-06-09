import { createClerkClient } from '@clerk/backend';
import { prisma } from './prisma';

const clerk = createClerkClient({
  secretKey: process.env['CLERK_SECRET_KEY'] ?? '',
});

export type AuthUserRecord = {
  id: string;
  username: string;
  avatarUrl: string | null;
};

const TTL_MS = Number(process.env['AUTH_USER_CACHE_TTL_MS'] ?? 10 * 60 * 1000);
const cache = new Map<string, { user: AuthUserRecord; expiresAt: number }>();

function readCached(clerkUserId: string): AuthUserRecord | null {
  const hit = cache.get(clerkUserId);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(clerkUserId);
    return null;
  }
  return hit.user;
}

function writeCached(clerkUserId: string, user: AuthUserRecord): AuthUserRecord {
  cache.set(clerkUserId, { user, expiresAt: Date.now() + TTL_MS });
  return user;
}

/** Resolve DB user from Clerk id — cached to cut Prisma/Clerk load on reconnect storms. */
export async function resolveAuthUser(clerkUserId: string): Promise<AuthUserRecord> {
  const cached = readCached(clerkUserId);
  if (cached) return cached;

  let user = await prisma.user.findUnique({
    where: { clerkId: clerkUserId },
    select: { id: true, username: true, avatarUrl: true },
  });

  if (!user) {
    const clerkUser = await clerk.users.getUser(clerkUserId);
    user = await prisma.user.create({
      data: {
        clerkId: clerkUserId,
        username:
          clerkUser.username ??
          clerkUser.firstName ??
          clerkUser.emailAddresses[0]?.emailAddress.split('@')[0] ??
          'Adventurer',
        avatarUrl: clerkUser.imageUrl ?? null,
      },
      select: { id: true, username: true, avatarUrl: true },
    });
  }

  return writeCached(clerkUserId, user);
}

export function invalidateAuthUserCache(clerkUserId?: string): void {
  if (clerkUserId) cache.delete(clerkUserId);
  else cache.clear();
}
