import type { DdbSourceSummary } from '@grimoire/shared';
import { safeRedis } from '../../lib/redis';
import { collectSourceIdsFromEntities } from './ddbContentNormalize';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import { getDdbItemPool, getDdbSpellPool, searchDdbMonsters } from './ddbLibrary';
import { fetchDdbCatalog } from './ddbSources';
import { runWithConcurrency } from './ddbMonsterFetch';

const ACCESSIBLE_CACHE_TTL = 60 * 60;
const MONSTER_PROBE_CONCURRENCY = 8;

function sourceAccessFromCatalog(raw: unknown): boolean | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  if (obj.isEnabled === false || obj.hasAccess === false) return false;
  if (obj.isOwned === true || obj.isPurchased === true || obj.hasAccess === true) return true;

  const accessType = String(obj.accessType ?? obj.ownership ?? obj.ownershipType ?? '').trim().toLowerCase();
  if (!accessType) return null;
  if (/own|purchas|share|entitl|subscri|included|unlocked|gift/.test(accessType)) return true;
  if (/lock|denied|unavailable|preview|none|blocked/.test(accessType)) return false;
  return null;
}

function collectCatalogAccessibleIds(json: Record<string, unknown>): Set<number> {
  const ids = new Set<number>();
  const buckets: unknown[] = [];
  if (Array.isArray(json.sources)) buckets.push(...json.sources);
  const data = json.data;
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.sources)) buckets.push(...d.sources);
    for (const key of ['userSources', 'entitlements', 'ownedSources', 'sourceEntitlements']) {
      if (Array.isArray(d[key])) buckets.push(...(d[key] as unknown[]));
    }
  }
  for (const key of ['userSources', 'entitlements', 'ownedSources', 'sourceEntitlements']) {
    if (Array.isArray(json[key])) buckets.push(...(json[key] as unknown[]));
  }

  for (const entry of buckets) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const id = Number(obj.id ?? obj.sourceId ?? obj.sourceCategoryId);
    if (!Number.isFinite(id) || id <= 0) continue;
    const access = sourceAccessFromCatalog(obj);
    if (access === true) ids.add(id);
  }
  return ids;
}

async function fetchConfigAccessibleIds(ctx: DdbAuthContext): Promise<Set<number>> {
  try {
    const catalog = await fetchDdbCatalog(ctx);
    const res = await fetch('https://www.dndbeyond.com/api/config/json', {
      headers: {
        ...authHeaders(ctx),
        Accept: '*/*',
        'User-Agent': 'Foundry VTT Character Integrator',
      },
    });
    if (!res.ok) return new Set();
    const json = (await res.json()) as Record<string, unknown>;
    const ids = collectCatalogAccessibleIds(json);
    for (const source of catalog.sourceList) {
      if (source.isEnabled === false) continue;
      const accessType = (source.accessType ?? '').toLowerCase();
      if (accessType && /own|purchas|share|entitl|subscri|included|unlocked/.test(accessType)) {
        ids.add(source.id);
      }
    }
    return ids;
  } catch {
    return new Set();
  }
}

async function probeMonsterSource(ctx: DdbAuthContext, sourceId: number): Promise<boolean> {
  try {
    const { items } = await searchDdbMonsters(ctx, { sourceId, take: 1, skip: 0 });
    return items.length > 0;
  } catch {
    return false;
  }
}

async function probeMonsterSources(ctx: DdbAuthContext, sourceIds: number[]): Promise<Set<number>> {
  const accessible = new Set<number>();
  await runWithConcurrency(sourceIds, MONSTER_PROBE_CONCURRENCY, async (sourceId) => {
    if (await probeMonsterSource(ctx, sourceId)) accessible.add(sourceId);
  });
  return accessible;
}

async function resolveAccessibleSourceIdsUncached(
  ctx: DdbAuthContext,
  opts?: { campaignId?: number },
): Promise<Set<number>> {
  const accessible = new Set<number>();

  const [configIds, spellPool, itemPool] = await Promise.all([
    fetchConfigAccessibleIds(ctx),
    getDdbSpellPool(ctx, opts?.campaignId),
    getDdbItemPool(ctx, opts?.campaignId),
  ]);

  for (const id of configIds) accessible.add(id);
  for (const id of collectSourceIdsFromEntities(spellPool)) accessible.add(id);
  for (const id of collectSourceIdsFromEntities(itemPool)) accessible.add(id);

  const catalog = await fetchDdbCatalog(ctx);
  const remaining = catalog.sourceList
    .map((s) => s.id)
    .filter((id) => !accessible.has(id));

  if (remaining.length > 0) {
    const probed = await probeMonsterSources(ctx, remaining);
    for (const id of probed) accessible.add(id);
  }

  return accessible;
}

/** Source book ids the linked DDB account can import (owned + campaign-shared). Cached ~1h. */
export async function resolveAccessibleSourceIds(
  ctx: DdbAuthContext,
  opts?: { campaignId?: number; force?: boolean },
): Promise<Set<number>> {
  const cacheKey = `ddb:accessible-sources:v1:${ctx.cacheId}:${opts?.campaignId ?? 'none'}`;
  if (!opts?.force) {
    const cached = await safeRedis<string | null>(null, (client) => client.get(cacheKey));
    if (cached) {
      const ids = JSON.parse(cached) as number[];
      return new Set(ids.filter((id) => Number.isFinite(id) && id > 0));
    }
  }

  const accessible = await resolveAccessibleSourceIdsUncached(ctx, opts);
  if (accessible.size > 0) {
    await safeRedis(undefined, (client) =>
      client.setex(cacheKey, ACCESSIBLE_CACHE_TTL, JSON.stringify([...accessible])),
    );
  }
  return accessible;
}

export async function listAccessibleDdbSources(
  ctx: DdbAuthContext,
  opts?: { campaignId?: number },
): Promise<DdbSourceSummary[]> {
  const catalog = await fetchDdbCatalog(ctx);
  const accessible = await resolveAccessibleSourceIds(ctx, opts);
  return catalog.sourceList.filter((s) => accessible.has(s.id));
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
    if (allowed.has(id)) accessible.push(id);
    else inaccessible.push(id);
  }
  return { accessible, inaccessible };
}

export function invalidateAccessibleSourceCache(cacheId: string): void {
  void safeRedis(undefined, async (client) => {
    const keys = await client.keys(`ddb:accessible-sources:v1:${cacheId}:*`);
    if (keys.length > 0) await client.del(...keys);
  });
}
