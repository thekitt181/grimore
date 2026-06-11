import {
  DDB_HOMEBREW_SOURCE_ID,
  DDB_HOMEBREW_SOURCE_NAME,
  type DdbSourceSummary,
} from '@grimoire/shared';
import { safeRedis } from '../../lib/redis';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import { fetchDdbCatalog } from './ddbSources';
import { fetchOwnedLibraryBooks, mapLibraryBooksToCatalogIds } from './ddbUserLibrary';

const ACCESSIBLE_CACHE_TTL = 60 * 60;
const CACHE_KEY_PREFIX = 'ddb:accessible-sources:v2';

function hasExplicitSourceAccess(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;

  if (obj.isEnabled === false || obj.hasAccess === false) return false;
  if (obj.isOwned === true || obj.isPurchased === true || obj.hasAccess === true) return true;

  const accessType = String(obj.accessType ?? obj.ownership ?? obj.ownershipType ?? '')
    .trim()
    .toLowerCase();
  if (!accessType) return false;
  if (/own|purchas|share|entitl|subscri|included|unlocked|gift/.test(accessType)) return true;
  return false;
}

/** Explicit entitlement flags from authenticated config JSON (never infer from catalog list). */
function collectExplicitEntitlementIds(json: Record<string, unknown>): Set<number> {
  const ids = new Set<number>();
  const buckets: unknown[] = [];
  for (const key of ['userSources', 'entitlements', 'ownedSources', 'sourceEntitlements']) {
    if (Array.isArray(json[key])) buckets.push(...(json[key] as unknown[]));
  }
  const data = json.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    for (const key of ['userSources', 'entitlements', 'ownedSources', 'sourceEntitlements']) {
      if (Array.isArray(d[key])) buckets.push(...(d[key] as unknown[]));
    }
  }

  for (const entry of buckets) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const id = Number(obj.id ?? obj.sourceId ?? obj.sourceCategoryId);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (hasExplicitSourceAccess(obj)) ids.add(id);
  }
  return ids;
}

async function fetchConfigEntitlementIds(ctx: DdbAuthContext): Promise<Set<number>> {
  try {
    const res = await fetch('https://www.dndbeyond.com/api/config/json', {
      headers: {
        ...authHeaders(ctx),
        Accept: '*/*',
        'User-Agent': 'Foundry VTT Character Integrator',
      },
    });
    if (!res.ok) return new Set();
    const json = (await res.json()) as Record<string, unknown>;
    return collectExplicitEntitlementIds(json);
  } catch {
    return new Set();
  }
}

async function resolveAccessibleSourceIdsUncached(
  ctx: DdbAuthContext,
  _opts?: { campaignId?: number },
): Promise<Set<number>> {
  const accessible = new Set<number>();
  const catalog = await fetchDdbCatalog(ctx);

  const [libraryBooks, configIds] = await Promise.all([
    fetchOwnedLibraryBooks(ctx),
    fetchConfigEntitlementIds(ctx),
  ]);

  for (const id of mapLibraryBooksToCatalogIds(libraryBooks, catalog.sourceList)) {
    accessible.add(id);
  }
  for (const id of configIds) accessible.add(id);

  return accessible;
}

function cacheKey(cacheId: string, campaignId?: number): string {
  return `${CACHE_KEY_PREFIX}:${cacheId}:${campaignId ?? 'none'}`;
}

/** Source book ids the linked DDB account can import (owned + shared). Cached ~1h. */
export async function resolveAccessibleSourceIds(
  ctx: DdbAuthContext,
  opts?: { campaignId?: number; force?: boolean },
): Promise<Set<number>> {
  const key = cacheKey(ctx.cacheId, opts?.campaignId);
  if (!opts?.force) {
    const cached = await safeRedis<string | null>(null, (client) => client.get(key));
    if (cached) {
      const ids = JSON.parse(cached) as number[];
      return new Set(ids.filter((id) => Number.isFinite(id) && id > 0));
    }
  }

  const accessible = await resolveAccessibleSourceIdsUncached(ctx, opts);
  await safeRedis(undefined, (client) =>
    client.setex(key, ACCESSIBLE_CACHE_TTL, JSON.stringify([...accessible])),
  );
  return accessible;
}

export async function listAccessibleDdbSources(
  ctx: DdbAuthContext,
  opts?: { campaignId?: number; force?: boolean },
): Promise<DdbSourceSummary[]> {
  const catalog = await fetchDdbCatalog(ctx);
  const accessible = await resolveAccessibleSourceIds(ctx, opts);
  const books = catalog.sourceList.filter((s) => accessible.has(s.id));

  const homebrew: DdbSourceSummary = {
    id: DDB_HOMEBREW_SOURCE_ID,
    name: DDB_HOMEBREW_SOURCE_NAME,
    category: 'Homebrew',
    accessType: 'Owned',
    isEnabled: true,
  };

  return [homebrew, ...books];
}

export async function filterAccessibleSourceIds(
  ctx: DdbAuthContext,
  sourceIds: number[],
  opts?: { campaignId?: number },
): Promise<{ accessible: number[]; inaccessible: number[] }> {
  const allowed = await resolveAccessibleSourceIds(ctx, opts);
  const accessible: number[] = [];
  const inaccessible: number[] = [];
  for (const id of sourceIds) {
    if (id === DDB_HOMEBREW_SOURCE_ID) {
      accessible.push(id);
      continue;
    }
    if (allowed.has(id)) accessible.push(id);
    else inaccessible.push(id);
  }
  return { accessible, inaccessible };
}

export function invalidateAccessibleSourceCache(cacheId: string): void {
  void safeRedis(undefined, async (client) => {
    const keys = await client.keys(`${CACHE_KEY_PREFIX}:${cacheId}:*`);
    if (keys.length > 0) await client.del(...keys);
    // Drop stale v1 cache that may contain all 135 books from monster probes.
    const legacy = await client.keys(`ddb:accessible-sources:v1:${cacheId}:*`);
    if (legacy.length > 0) await client.del(...legacy);
  });
}
