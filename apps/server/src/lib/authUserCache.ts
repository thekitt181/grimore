import { authPrisma, prisma } from './prisma';

export type AuthUserRecord = {
  id: string;
  authUserId: string;
  username: string;
  avatarUrl: string | null;
};

const cache = new Map<string, { user: AuthUserRecord; expiresAt: number }>();
const TTL_MS = 60_000;

function readCached(authUserId: string): AuthUserRecord | null {
  const hit = cache.get(authUserId);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(authUserId);
    return null;
  }
  return hit.user;
}

function writeCached(authUserId: string, user: AuthUserRecord): AuthUserRecord {
  cache.set(authUserId, { user, expiresAt: Date.now() + TTL_MS });
  return user;
}

function defaultUsername(name: string, email: string): string {
  const fromName = name?.trim();
  if (fromName) return fromName.slice(0, 32);
  return email.split('@')[0]?.slice(0, 32) || 'adventurer';
}

/** Resolve app User from Better Auth user id — cached to cut Prisma load on reconnect storms. */
export async function resolveAuthUser(authUserId: string): Promise<AuthUserRecord> {
  const cached = readCached(authUserId);
  if (cached) return cached;

  let user = await prisma.user.findUnique({
    where: { authUserId },
    select: { id: true, authUserId: true, username: true, avatarUrl: true },
  });

  if (!user) {
    const authUser = await authPrisma.authUser.findUnique({ where: { id: authUserId } });
    if (!authUser) {
      throw new Error(`Auth user not found: ${authUserId}`);
    }
    user = await prisma.user.create({
      data: {
        authUserId,
        username: defaultUsername(authUser.name, authUser.email),
        avatarUrl: authUser.image,
      },
      select: { id: true, authUserId: true, username: true, avatarUrl: true },
    });
  }

  return writeCached(authUserId, user);
}

export function invalidateAuthUserCache(authUserId?: string): void {
  if (authUserId) cache.delete(authUserId);
  else cache.clear();
}
