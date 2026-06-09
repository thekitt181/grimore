import type {
  DdbLibraryImportResult,
  DdbLibraryItemSummary,
  DdbLibraryMonsterSummary,
  DdbLibrarySpellSummary,
  OwlbearItem,
  OwlbearMonster,
  OwlbearSpell,
} from '@grimoire/shared';
import { DDB_SPELL_CLASS_IDS, DDB_URLS } from './config';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import {
  ddbEntityId,
  entryHasSourceId,
  normalizeDdbItemSummary,
  normalizeDdbItemToCompendium,
  normalizeDdbMonsterSummary,
  normalizeDdbMonsterToCompendium,
  normalizeDdbSpellSummary,
  normalizeDdbSpellToCompendium,
} from './ddbContentNormalize';
import { getCatalogRevision, saveItemsBulk, saveMonstersBulk, saveSpellsBulk } from '../compendiumSync';
import { unlockCompendiumSource } from '../compendiumSourcePolicy';
import { splitCompendiumSources } from '@grimoire/shared';
import { redis } from '../../lib/redis';
import {
  fetchDdbCatalog,
  resolveDdbSourceLabel,
  type DdbCatalog,
} from './ddbSources';
import { enrichEntitiesWithFullDefinitions } from './ddbDefinitionFetch';
import {
  enrichMonstersForImport,
  fetchMonstersForImport,
  monsterHasImportableStatBlock,
} from './ddbMonsterFetch';

export { fetchDdbMonsterDetail } from './ddbMonsterFetch';

const SPELL_CACHE_TTL = 60 * 60;
const ITEM_CACHE_TTL = 60 * 30;
const IMPORT_BATCH = 100;
const CATALOG_CACHE_TTL = 60 * 60;

async function loadDdbCatalog(ctx: DdbAuthContext): Promise<DdbCatalog> {
  const cacheKey = `ddb:catalog:v4:${ctx.cacheId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached) as {
        sourceNames: [number, string][];
        challengeRatingById: [number, number][];
        challengeRatingXpById: [number, number][];
        monsterTypes: [number, string][];
        alignments: [number, string][];
        senses: [number, string][];
        movements: [number, string][];
      };
      return {
        sourceNames: new Map(parsed.sourceNames),
        challengeRatingById: new Map(parsed.challengeRatingById),
        challengeRatingXpById: new Map(parsed.challengeRatingXpById),
        monsterTypes: new Map(parsed.monsterTypes),
        alignments: new Map(parsed.alignments),
        senses: new Map(parsed.senses),
        movements: new Map(parsed.movements),
      };
    }
  } catch { /* ignore */ }

  const fetched = await fetchDdbCatalog(ctx);
  const catalog: DdbCatalog = {
    sourceNames: fetched.sourceNames,
    challengeRatingById: fetched.challengeRatingById,
    challengeRatingXpById: fetched.challengeRatingXpById,
    monsterTypes: fetched.monsterTypes,
    alignments: fetched.alignments,
    senses: fetched.senses,
    movements: fetched.movements,
  };
  if (catalog.sourceNames.size > 0) {
    try {
      await redis.setex(
        cacheKey,
        CATALOG_CACHE_TTL,
        JSON.stringify({
          sourceNames: [...catalog.sourceNames.entries()],
          challengeRatingById: [...catalog.challengeRatingById.entries()],
          challengeRatingXpById: [...catalog.challengeRatingXpById.entries()],
          monsterTypes: [...catalog.monsterTypes.entries()],
          alignments: [...catalog.alignments.entries()],
          senses: [...catalog.senses.entries()],
          movements: [...catalog.movements.entries()],
        }),
      );
    } catch { /* ignore */ }
  }
  return catalog;
}

function applyBookSource<T extends { source?: string }>(
  entry: T,
  raw: Record<string, unknown>,
  catalog: DdbCatalog,
  sourceId?: number,
): T {
  const source = resolveDdbSourceLabel(raw, catalog.sourceNames, sourceId);
  if (source === 'D&D Beyond') return entry;
  return { ...entry, source };
}

function summaryWithBookSource<T extends { source?: string }>(
  summary: T,
  raw: Record<string, unknown>,
  catalog: DdbCatalog,
  sourceId?: number,
): T {
  const source = resolveDdbSourceLabel(raw, catalog.sourceNames, sourceId);
  if (source === 'D&D Beyond') return summary;
  return { ...summary, source };
}

function unwrapList<T>(json: unknown, mapper: (raw: Record<string, unknown>) => T | null): T[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  const list = Array.isArray(root.data)
    ? root.data
    : Array.isArray(root.items)
      ? root.items
      : Array.isArray(json)
        ? json
        : [];
  const out: T[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const mapped = mapper(entry as Record<string, unknown>);
    if (mapped) out.push(mapped);
  }
  return out;
}

function unwrapCharacterService<T extends Record<string, unknown>>(json: unknown): T[] {
  if (!json || typeof json !== 'object') return [];
  const root = json as Record<string, unknown>;
  if (root.success === false && !Array.isArray(root.data)) return [];
  if (Array.isArray(root.data)) return root.data as T[];
  if (Array.isArray(root.items)) return root.items as T[];
  if (Array.isArray(root.spells)) return root.spells as T[];
  if (Array.isArray(json)) return json as T[];
  return [];
}

function mergeByEntityId(entries: Record<string, unknown>[]): Record<string, unknown>[] {
  const byId = new Map<number, Record<string, unknown>>();
  for (const entry of entries) {
    const id = ddbEntityId(entry);
    if (id != null) byId.set(id, entry);
  }
  return [...byId.values()];
}

export async function searchDdbMonsters(
  ctx: DdbAuthContext,
  opts: { q?: string; sourceId?: number; sourceIds?: number[]; skip?: number; take?: number },
): Promise<{ items: DdbLibraryMonsterSummary[]; total: number }> {
  const skip = opts.skip ?? 0;
  const take = Math.min(opts.take ?? 40, 100);
  const search = (opts.q ?? '').trim();
  const catalog = await loadDdbCatalog(ctx);
  const sourceIds = opts.sourceIds?.length
    ? [...new Set(opts.sourceIds)]
    : opts.sourceId
      ? [opts.sourceId]
      : undefined;
  const preferredSourceId = sourceIds?.length === 1 ? sourceIds[0] : opts.sourceId;
  const url = DDB_URLS.monstersSearch(skip, take, search, {
    homebrew: true,
    sourceIds,
  });

  const res = await fetch(url, { headers: authHeaders(ctx) });
  if (!res.ok) throw new Error(`DDB monster search failed (${res.status})`);
  const json = (await res.json()) as Record<string, unknown>;
  const items = unwrapList(json, (raw) =>
    normalizeDdbMonsterSummary(raw, catalog, preferredSourceId),
  );
  const total = Number((json.pagination as Record<string, unknown> | undefined)?.total ?? items.length);
  return { items, total: Number.isFinite(total) ? total : items.length };
}

async function fetchGameDataList(
  ctx: DdbAuthContext,
  url: string,
): Promise<Record<string, unknown>[]> {
  const res = await fetch(url, { headers: authHeaders(ctx) });
  if (!res.ok) return [];
  const json = await res.json();
  return unwrapCharacterService<Record<string, unknown>>(json);
}

async function fetchSpellPoolOnce(
  ctx: DdbAuthContext,
  campaignId?: number,
): Promise<Record<string, unknown>[]> {
  const urls = DDB_SPELL_CLASS_IDS.flatMap((cls) => [
    DDB_URLS.gameDataSpells(cls.id, 20, campaignId),
    DDB_URLS.gameDataAlwaysKnownSpells(cls.id, 20, campaignId),
    DDB_URLS.gameDataAlwaysPreparedSpells(cls.id, 20, campaignId),
  ]);

  const batches = await Promise.all(urls.map((url) => fetchGameDataList(ctx, url)));
  return mergeByEntityId(batches.flat());
}

async function loadSpellPool(ctx: DdbAuthContext, campaignId?: number): Promise<Record<string, unknown>[]> {
  const cacheKey = `ddb:spells:v3:${ctx.cacheId}:${campaignId ?? 'none'}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Record<string, unknown>[];
  } catch { /* ignore */ }

  const base = await fetchSpellPoolOnce(ctx);
  const shared = campaignId ? await fetchSpellPoolOnce(ctx, campaignId) : [];
  const pool = mergeByEntityId([...base, ...shared]);

  if (pool.length > 0) {
    try {
      await redis.setex(cacheKey, SPELL_CACHE_TTL, JSON.stringify(pool));
    } catch { /* ignore */ }
  } else {
    console.warn('[DDB] spell pool empty — check Cobalt token and campaign link', {
      campaignId,
      ddbUserId: ctx.ddbUserId,
    });
  }
  return pool;
}

function filterPoolBySource(
  pool: Record<string, unknown>[],
  sourceId: number,
): Record<string, unknown>[] {
  return pool.filter((raw) => entryHasSourceId(raw, sourceId));
}

function filterPoolBySources(
  pool: Record<string, unknown>[],
  sourceIds: number[],
): Record<string, unknown>[] {
  if (sourceIds.length === 0) return pool;
  const unique = [...new Set(sourceIds)];
  return pool.filter((raw) => unique.some((id) => entryHasSourceId(raw, id)));
}

export async function searchDdbSpells(
  ctx: DdbAuthContext,
  opts: { q?: string; sourceId?: number; sourceIds?: number[]; campaignId?: number; limit?: number },
): Promise<DdbLibrarySpellSummary[]> {
  const q = (opts.q ?? '').trim().toLowerCase();
  const limit = Math.min(opts.limit ?? 200, 500);
  const catalog = await loadDdbCatalog(ctx);
  const sourceIds = opts.sourceIds?.length
    ? [...new Set(opts.sourceIds)]
    : opts.sourceId
      ? [opts.sourceId]
      : undefined;
  const preferredSourceId = sourceIds?.length === 1 ? sourceIds[0] : opts.sourceId;
  const pool = sourceIds?.length
    ? filterPoolBySources(await loadSpellPool(ctx, opts.campaignId), sourceIds)
    : await loadSpellPool(ctx, opts.campaignId);

  let items = pool
    .map((entry) => {
      const summary = normalizeDdbSpellSummary(entry);
      return summary ? summaryWithBookSource(summary, entry, catalog, preferredSourceId) : null;
    })
    .filter((s): s is DdbLibrarySpellSummary => Boolean(s));

  if (q) {
    items = items.filter((s) => s.name.toLowerCase().includes(q) || (s.source ?? '').toLowerCase().includes(q));
  }

  items.sort((a, b) => a.name.localeCompare(b.name) || a.level - b.level);
  return items.slice(0, limit);
}

async function fetchItemPoolOnce(
  ctx: DdbAuthContext,
  campaignId?: number,
): Promise<Record<string, unknown>[]> {
  const url = DDB_URLS.gameDataItems(campaignId);
  const res = await fetch(url, { headers: authHeaders(ctx) });
  if (!res.ok) {
    console.warn(`[DDB] item fetch failed status=${res.status}`, { campaignId });
    return [];
  }
  const json = await res.json();
  return unwrapCharacterService<Record<string, unknown>>(json);
}

async function loadItemPool(ctx: DdbAuthContext, campaignId?: number): Promise<Record<string, unknown>[]> {
  const cacheKey = `ddb:items:v2:${ctx.cacheId}:${campaignId ?? 'none'}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Record<string, unknown>[];
  } catch { /* ignore */ }

  const base = await fetchItemPoolOnce(ctx);
  const shared = campaignId ? await fetchItemPoolOnce(ctx, campaignId) : [];
  const pool = mergeByEntityId([...base, ...shared]);

  if (pool.length > 0) {
    try {
      await redis.setex(cacheKey, ITEM_CACHE_TTL, JSON.stringify(pool));
    } catch { /* ignore */ }
  } else {
    console.warn('[DDB] item pool empty — check Cobalt token and campaign link', {
      campaignId,
      ddbUserId: ctx.ddbUserId,
    });
  }
  return pool;
}

export async function searchDdbItems(
  ctx: DdbAuthContext,
  opts: { q?: string; sourceId?: number; sourceIds?: number[]; campaignId?: number; limit?: number },
): Promise<DdbLibraryItemSummary[]> {
  const q = (opts.q ?? '').trim().toLowerCase();
  const limit = Math.min(opts.limit ?? 200, 500);
  const catalog = await loadDdbCatalog(ctx);
  const sourceIds = opts.sourceIds?.length
    ? [...new Set(opts.sourceIds)]
    : opts.sourceId
      ? [opts.sourceId]
      : undefined;
  const preferredSourceId = sourceIds?.length === 1 ? sourceIds[0] : opts.sourceId;
  const pool = sourceIds?.length
    ? filterPoolBySources(await loadItemPool(ctx, opts.campaignId), sourceIds)
    : await loadItemPool(ctx, opts.campaignId);

  let items = pool
    .map((entry) => {
      const summary = normalizeDdbItemSummary(entry);
      return summary ? summaryWithBookSource(summary, entry, catalog, preferredSourceId) : null;
    })
    .filter((i): i is DdbLibraryItemSummary => Boolean(i));

  if (q) {
    items = items.filter((i) =>
      i.name.toLowerCase().includes(q)
      || i.description.toLowerCase().includes(q)
      || (i.type ?? '').toLowerCase().includes(q),
    );
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return items.slice(0, limit);
}

function poolById(pool: Record<string, unknown>[]): Map<number, Record<string, unknown>> {
  const byId = new Map<number, Record<string, unknown>>();
  for (const entry of pool) {
    const id = ddbEntityId(entry);
    if (id != null) byId.set(id, entry);
  }
  return byId;
}

function resolveImportSaveOpts(entry: { source?: string }) {
  return entry.source && entry.source !== 'D&D Beyond' && entry.source !== 'Custom'
    ? { saveAs: 'replace' as const }
    : { saveAs: 'homebrew' as const };
}

async function unlockImportedBookSources(catalog: DdbCatalog, sourceIds: number[]): Promise<string[]> {
  const unlocked: string[] = [];
  for (const sourceId of sourceIds) {
    const label = catalog.sourceNames.get(sourceId);
    if (!label || label === 'D&D Beyond') continue;
    try {
      await unlockCompendiumSource(label);
      unlocked.push(label);
    } catch (err) {
      console.warn(
        '[DDB Import] Could not unlock compendium source:',
        label,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return unlocked;
}

async function unlockImportedBookSourceLabels(sourceLabels: string[]): Promise<string[]> {
  const unlocked: string[] = [];
  for (const label of [...new Set(sourceLabels)]) {
    if (!label || label === 'D&D Beyond' || label.toLowerCase() === 'custom') continue;
    try {
      await unlockCompendiumSource(label);
      unlocked.push(label);
    } catch (err) {
      console.warn(
        '[DDB Import] Could not unlock compendium source:',
        label,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return unlocked;
}

function sourceLabelsFromEntries(entries: Array<{ source?: string }>): string[] {
  const labels = new Set<string>();
  for (const entry of entries) {
    if (!entry.source) continue;
    for (const part of splitCompendiumSources(entry.source)) {
      if (part && part !== 'D&D Beyond' && part.toLowerCase() !== 'custom') {
        labels.add(part);
      }
    }
  }
  return [...labels];
}

type ImportBatchMeta = {
  mongoPersisted: boolean;
  savedEntries: Array<{ source?: string }>;
};

async function finalizeDdbImportResult(
  result: DdbLibraryImportResult,
  catalog: DdbCatalog,
  meta: ImportBatchMeta,
  sourceIds?: number[],
): Promise<DdbLibraryImportResult> {
  if (result.imported.length === 0) return result;

  const unlockedFromIds = sourceIds?.length
    ? await unlockImportedBookSources(catalog, sourceIds)
    : [];
  const unlockedFromLabels = await unlockImportedBookSourceLabels(
    sourceLabelsFromEntries(meta.savedEntries),
  );

  return {
    ...result,
    catalogRev: getCatalogRevision() ?? undefined,
    sourcesUnlocked: [...new Set([...unlockedFromIds, ...unlockedFromLabels])],
    mongoPersisted: meta.mongoPersisted,
  };
}

async function importMonsterIds(
  ctx: DdbAuthContext,
  ids: number[],
  catalog: DdbCatalog,
  sourceId?: number,
): Promise<DdbLibraryImportResult> {
  const imported: DdbLibraryImportResult['imported'] = [];
  const errors: DdbLibraryImportResult['errors'] = [];
  let mongoPersisted = true;
  const savedEntries: Array<{ source?: string }> = [];

  for (let i = 0; i < ids.length; i += IMPORT_BATCH) {
    const batchIds = ids.slice(i, i + IMPORT_BATCH);
    const rawById = await fetchMonstersForImport(ctx, batchIds);
    const enriched = await enrichMonstersForImport(ctx, [...rawById.values()]);
    const enrichedById = new Map<number, Record<string, unknown>>();
    for (const raw of enriched) {
      const id = Number(raw.id);
      if (Number.isFinite(id) && id > 0) enrichedById.set(id, raw);
    }

    const pending: Array<{ entry: OwlbearMonster; ddbId: number }> = [];

    for (const id of batchIds) {
      try {
        const raw = enrichedById.get(id) ?? rawById.get(id);
        if (!raw) {
          errors.push({ id, message: 'Monster not found' });
          continue;
        }
        if (!monsterHasImportableStatBlock(raw)) {
          errors.push({ id, message: 'Incomplete stat block from D&D Beyond' });
          continue;
        }
        const withSource = normalizeDdbMonsterToCompendium(raw, catalog, sourceId);
        if (!withSource) {
          errors.push({ id, message: 'Could not parse monster' });
          continue;
        }
        pending.push({
          entry: applyBookSource(withSource, raw, catalog, sourceId),
          ddbId: id,
        });
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    if (pending.length === 0) continue;

    try {
      const batch = await saveMonstersBulk(
        pending.map(({ entry }) => ({ entry, opts: resolveImportSaveOpts(entry) })),
      );
      mongoPersisted = mongoPersisted && batch.persist.mongoPersisted;
      savedEntries.push(...batch.entries);
      for (let j = 0; j < batch.entries.length; j++) {
        imported.push({
          kind: 'monster',
          ddbId: pending[j].ddbId,
          compendiumId: batch.entries[j].id,
          name: batch.entries[j].name,
          source: batch.entries[j].source,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      for (const { ddbId } of pending) {
        errors.push({ id: ddbId, message });
      }
    }
  }
  return finalizeDdbImportResult(
    { imported, errors },
    catalog,
    { mongoPersisted, savedEntries },
    sourceId != null ? [sourceId] : undefined,
  );
}

async function importSpellIds(
  ctx: DdbAuthContext,
  ids: number[],
  catalog: DdbCatalog,
  campaignId?: number,
  sourceId?: number,
): Promise<DdbLibraryImportResult> {
  const imported: DdbLibraryImportResult['imported'] = [];
  const errors: DdbLibraryImportResult['errors'] = [];
  let mongoPersisted = true;
  const savedEntries: Array<{ source?: string }> = [];
  const pool = await loadSpellPool(ctx, campaignId);
  const byId = poolById(pool);

  for (let i = 0; i < ids.length; i += IMPORT_BATCH) {
    const batchIds = ids.slice(i, i + IMPORT_BATCH);
    const batchRaw = batchIds
      .map((id) => byId.get(id))
      .filter((raw): raw is Record<string, unknown> => Boolean(raw));
    const enriched = await enrichEntitiesWithFullDefinitions(ctx, 'spell', batchRaw, campaignId);
    const enrichedById = poolById(enriched);

    const pending: Array<{ entry: OwlbearSpell; ddbId: number }> = [];

    for (const id of batchIds) {
      try {
        const raw = enrichedById.get(id) ?? byId.get(id);
        if (!raw) {
          errors.push({ id, message: 'Spell not in your accessible library (try linking DDB campaign)' });
          continue;
        }
        const entry = normalizeDdbSpellToCompendium(raw);
        if (!entry) {
          errors.push({ id, message: 'Could not parse spell' });
          continue;
        }
        pending.push({ entry: applyBookSource(entry, raw, catalog, sourceId), ddbId: id });
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    if (pending.length === 0) continue;

    try {
      const batch = await saveSpellsBulk(
        pending.map(({ entry }) => ({ entry, opts: resolveImportSaveOpts(entry) })),
      );
      mongoPersisted = mongoPersisted && batch.persist.mongoPersisted;
      savedEntries.push(...batch.entries);
      for (let j = 0; j < batch.entries.length; j++) {
        imported.push({
          kind: 'spell',
          ddbId: pending[j].ddbId,
          compendiumId: batch.entries[j].id,
          name: batch.entries[j].name,
          source: batch.entries[j].source,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      for (const { ddbId } of pending) {
        errors.push({ id: ddbId, message });
      }
    }
  }
  return finalizeDdbImportResult(
    { imported, errors },
    catalog,
    { mongoPersisted, savedEntries },
    sourceId != null ? [sourceId] : undefined,
  );
}

async function importItemIds(
  ctx: DdbAuthContext,
  ids: number[],
  catalog: DdbCatalog,
  campaignId?: number,
  sourceId?: number,
): Promise<DdbLibraryImportResult> {
  const imported: DdbLibraryImportResult['imported'] = [];
  const errors: DdbLibraryImportResult['errors'] = [];
  let mongoPersisted = true;
  const savedEntries: Array<{ source?: string }> = [];
  const pool = await loadItemPool(ctx, campaignId);
  const byId = poolById(pool);

  for (let i = 0; i < ids.length; i += IMPORT_BATCH) {
    const batchIds = ids.slice(i, i + IMPORT_BATCH);
    const batchRaw = batchIds
      .map((id) => byId.get(id))
      .filter((raw): raw is Record<string, unknown> => Boolean(raw));
    const enriched = await enrichEntitiesWithFullDefinitions(ctx, 'item', batchRaw, campaignId);
    const enrichedById = poolById(enriched);

    const pending: Array<{ entry: OwlbearItem; ddbId: number }> = [];

    for (const id of batchIds) {
      try {
        const raw = enrichedById.get(id) ?? byId.get(id);
        if (!raw) {
          errors.push({ id, message: 'Item not in your accessible library (try linking DDB campaign)' });
          continue;
        }
        const entry = normalizeDdbItemToCompendium(raw);
        if (!entry) {
          errors.push({ id, message: 'Could not parse item' });
          continue;
        }
        pending.push({ entry: applyBookSource(entry, raw, catalog, sourceId), ddbId: id });
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    if (pending.length === 0) continue;

    try {
      const batch = await saveItemsBulk(
        pending.map(({ entry }) => ({ entry, opts: resolveImportSaveOpts(entry) })),
      );
      mongoPersisted = mongoPersisted && batch.persist.mongoPersisted;
      savedEntries.push(...batch.entries);
      for (let j = 0; j < batch.entries.length; j++) {
        imported.push({
          kind: 'item',
          ddbId: pending[j].ddbId,
          compendiumId: batch.entries[j].id,
          name: batch.entries[j].name,
          source: batch.entries[j].source,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Import failed';
      for (const { ddbId } of pending) {
        errors.push({ id: ddbId, message });
      }
    }
  }
  return finalizeDdbImportResult(
    { imported, errors },
    catalog,
    { mongoPersisted, savedEntries },
    sourceId != null ? [sourceId] : undefined,
  );
}


export async function importDdbLibraryEntries(
  ctx: DdbAuthContext,
  opts: {
    kind: 'monster' | 'item' | 'spell';
    ids: number[];
    campaignId?: number;
    sourceId?: number;
  },
): Promise<DdbLibraryImportResult> {
  const catalog = await loadDdbCatalog(ctx);
  if (opts.kind === 'monster') return importMonsterIds(ctx, opts.ids, catalog, opts.sourceId);
  if (opts.kind === 'spell') {
    return importSpellIds(ctx, opts.ids, catalog, opts.campaignId, opts.sourceId);
  }
  return importItemIds(ctx, opts.ids, catalog, opts.campaignId, opts.sourceId);
}

export async function importAllDdbLibraryFromSource(
  ctx: DdbAuthContext,
  opts: {
    kind: 'monster' | 'item' | 'spell';
    sourceId: number;
    campaignId?: number;
  },
): Promise<DdbLibraryImportResult> {
  const catalog = await loadDdbCatalog(ctx);

  if (opts.kind === 'monster') {
    const allIds: number[] = [];
    let skip = 0;
    const take = 100;
    while (true) {
      const { items, total } = await searchDdbMonsters(ctx, {
        sourceId: opts.sourceId,
        skip,
        take,
      });
      allIds.push(...items.map((m) => m.ddbId));
      skip += take;
      if (items.length === 0 || skip >= total) break;
    }
    return importMonsterIds(ctx, allIds, catalog, opts.sourceId);
  }

  if (opts.kind === 'spell') {
    const pool = filterPoolBySource(await loadSpellPool(ctx, opts.campaignId), opts.sourceId);
    const ids = pool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
    return importSpellIds(ctx, ids, catalog, opts.campaignId, opts.sourceId);
  }

  const pool = filterPoolBySource(await loadItemPool(ctx, opts.campaignId), opts.sourceId);
  const ids = pool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
  return importItemIds(ctx, ids, catalog, opts.campaignId, opts.sourceId);
}

function mergeImportResults(...parts: DdbLibraryImportResult[]): DdbLibraryImportResult {
  const imported = parts.flatMap((p) => p.imported);
  const errors = parts.flatMap((p) => p.errors);
  if (imported.length === 0) {
    return { imported, errors };
  }
  return {
    imported,
    errors,
    sourcesUnlocked: [...new Set(parts.flatMap((p) => p.sourcesUnlocked ?? []))],
    mongoPersisted: parts.every((p) => p.mongoPersisted !== false),
    catalogRev: getCatalogRevision() ?? parts.map((p) => p.catalogRev).filter(Boolean).pop(),
  };
}

export async function importAllDdbLibraryFromSources(
  ctx: DdbAuthContext,
  opts: {
    sourceIds: number[];
    campaignId?: number;
    /** Defaults to monsters, spells, and items. */
    kinds?: Array<'monster' | 'item' | 'spell'>;
  },
): Promise<DdbLibraryImportResult> {
  const unique = [...new Set(opts.sourceIds.filter((id) => Number.isFinite(id) && id > 0))];
  if (unique.length === 0) {
    return { imported: [], errors: [{ id: 0, message: 'No source books selected' }] };
  }

  const kinds = opts.kinds?.length ? opts.kinds : (['monster', 'spell', 'item'] as const);

  const results: DdbLibraryImportResult[] = [];
  for (const sourceId of unique) {
    for (const kind of kinds) {
      results.push(
        await importAllDdbLibraryFromSource(ctx, {
          kind,
          sourceId,
          campaignId: opts.campaignId,
        }),
      );
    }
  }
  const merged = mergeImportResults(...results);
  return merged;
}
