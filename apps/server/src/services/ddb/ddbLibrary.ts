import type {
  DdbLibraryImportResult,
  DdbLibraryItemSummary,
  DdbLibraryMonsterSummary,
  DdbLibrarySpellSummary,
  OwlbearItem,
  OwlbearMonster,
  OwlbearSpell,
} from '@grimoire/shared';
import { DDB_HOMEBREW_SOURCE_ID, DDB_HOMEBREW_SOURCE_LABEL } from '@grimoire/shared';
import { DDB_SPELL_CLASS_IDS, DDB_URLS } from './config';
import { authHeaders, type DdbAuthContext } from './ddbAuthContext';
import {
  ddbEntityId,
  ddbMonsterCanImport,
  entryHasSourceId,
  isDdbHomebrewEntity,
  normalizeDdbItemSummary,
  normalizeDdbItemToCompendium,
  normalizeDdbMonsterSummary,
  normalizeDdbMonsterToCompendium,
  normalizeDdbSpellSummary,
  normalizeDdbSpellToCompendium,
} from './ddbContentNormalize';
import { getCatalogRevision, saveItemsBulkForImport, saveMonstersBulkForImport, saveSpellsBulkForImport } from '../compendiumSync';
import { unlockCompendiumSourcesBulk } from '../compendiumSourcePolicy';
import { sourceMatchesLocked } from '../compendiumVisibility';
import { ensureBundledSourcesLocked, ensureImportedSourcesUnlocked } from '../compendiumBundledLock';
import { ImportSkipIndex, loadImportSkipIndex } from '../compendiumImportIndex';
import type { CompendiumKind } from '../compendiumOwlbearPersist';
import { splitCompendiumSources } from '@grimoire/shared';
import { safeRedis } from '../../lib/redis';
import {
  fetchDdbCatalog,
  resolveDdbSourceLabel,
  type DdbCatalog,
} from './ddbSources';
import { enrichEntitiesWithFullDefinitions } from './ddbDefinitionFetch';
import {
  fetchMonstersForImport,
} from './ddbMonsterFetch';

export { fetchDdbMonsterDetail } from './ddbMonsterFetch';

const SPELL_CACHE_TTL = 60 * 60;
const ITEM_CACHE_TTL = 60 * 30;
const FETCH_BATCH = 150;
const MONSTER_IMPORT_BATCH = 25;
/** Typed Mongo collections — safe to write larger batches (no 16MB global doc RMW). */
const SAVE_BATCH = 60;
const CATALOG_CACHE_TTL = 60 * 60;

async function loadDdbCatalog(ctx: DdbAuthContext): Promise<DdbCatalog> {
  const cacheKey = `ddb:catalog:v4:${ctx.cacheId}`;
  const cached = await safeRedis<string | null>(null, (client) => client.get(cacheKey));
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
    await safeRedis(undefined, (client) =>
      client.setex(
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
      ),
    );
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

function splitSourceFilter(sourceIds?: number[]): {
  bookSourceIds: number[];
  includeHomebrew: boolean;
  homebrewOnly: boolean;
} {
  const unique = [...new Set(sourceIds ?? [])];
  const includeHomebrew = unique.includes(DDB_HOMEBREW_SOURCE_ID);
  const bookSourceIds = unique.filter((id) => id > 0);
  return {
    bookSourceIds,
    includeHomebrew,
    homebrewOnly: includeHomebrew && bookSourceIds.length === 0,
  };
}

function filterPoolByHomebrew(pool: Record<string, unknown>[]): Record<string, unknown>[] {
  return pool.filter((raw) => isDdbHomebrewEntity(raw));
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
  const { bookSourceIds, includeHomebrew, homebrewOnly } = splitSourceFilter(sourceIds);
  const preferredSourceId = bookSourceIds.length === 1 ? bookSourceIds[0] : opts.sourceId;
  const url = DDB_URLS.monstersSearch(skip, take, search, {
    homebrewOnly,
    homebrew: includeHomebrew || bookSourceIds.length === 0,
    sourceIds: bookSourceIds.length > 0 ? bookSourceIds : undefined,
  });

  const res = await fetch(url, { headers: authHeaders(ctx) });
  if (!res.ok) throw new Error(`DDB monster search failed (${res.status})`);
  const json = (await res.json()) as Record<string, unknown>;
  let items = unwrapList(json, (raw) =>
    normalizeDdbMonsterSummary(raw, catalog, preferredSourceId),
  );
  if (includeHomebrew && bookSourceIds.length > 0) {
    items = items.filter((item) => item.isHomebrew || bookSourceIds.some((id) => {
      const label = catalog.sourceNames.get(id);
      return label && item.source?.includes(label);
    }));
  } else if (homebrewOnly) {
    items = items.filter((item) => item.isHomebrew);
  }
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
  const cached = await safeRedis<string | null>(null, (client) => client.get(cacheKey));
  if (cached) return JSON.parse(cached) as Record<string, unknown>[];

  const base = await fetchSpellPoolOnce(ctx);
  const shared = campaignId ? await fetchSpellPoolOnce(ctx, campaignId) : [];
  const pool = mergeByEntityId([...base, ...shared]);

  if (pool.length > 0) {
    await safeRedis(undefined, (client) =>
      client.setex(cacheKey, SPELL_CACHE_TTL, JSON.stringify(pool)),
    );
  } else {
    console.warn('[DDB] spell pool empty — check Cobalt token and campaign link', {
      campaignId,
      ddbUserId: ctx.ddbUserId,
    });
  }
  return pool;
}

/** Spell pool for access checks (owned + optional campaign-shared). */
export async function getDdbSpellPool(
  ctx: DdbAuthContext,
  campaignId?: number,
): Promise<Record<string, unknown>[]> {
  return loadSpellPool(ctx, campaignId);
}

/** Item pool for access checks (owned + optional campaign-shared). */
export async function getDdbItemPool(
  ctx: DdbAuthContext,
  campaignId?: number,
): Promise<Record<string, unknown>[]> {
  return loadItemPool(ctx, campaignId);
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
  const { bookSourceIds, includeHomebrew, homebrewOnly } = splitSourceFilter(sourceIds);
  const preferredSourceId = bookSourceIds.length === 1 ? bookSourceIds[0] : opts.sourceId;
  let pool = await loadSpellPool(ctx, opts.campaignId);
  if (homebrewOnly) {
    pool = filterPoolByHomebrew(pool);
  } else if (bookSourceIds.length > 0) {
    pool = filterPoolBySources(pool, bookSourceIds);
    if (includeHomebrew) {
      pool = mergeByEntityId([...pool, ...filterPoolByHomebrew(await loadSpellPool(ctx, opts.campaignId))]);
    }
  }

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
  const cached = await safeRedis<string | null>(null, (client) => client.get(cacheKey));
  if (cached) return JSON.parse(cached) as Record<string, unknown>[];

  const base = await fetchItemPoolOnce(ctx);
  const shared = campaignId ? await fetchItemPoolOnce(ctx, campaignId) : [];
  const pool = mergeByEntityId([...base, ...shared]);

  if (pool.length > 0) {
    await safeRedis(undefined, (client) =>
      client.setex(cacheKey, ITEM_CACHE_TTL, JSON.stringify(pool)),
    );
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
  const { bookSourceIds, includeHomebrew, homebrewOnly } = splitSourceFilter(sourceIds);
  const preferredSourceId = bookSourceIds.length === 1 ? bookSourceIds[0] : opts.sourceId;
  let pool = await loadItemPool(ctx, opts.campaignId);
  if (homebrewOnly) {
    pool = filterPoolByHomebrew(pool);
  } else if (bookSourceIds.length > 0) {
    pool = filterPoolBySources(pool, bookSourceIds);
    if (includeHomebrew) {
      pool = mergeByEntityId([...pool, ...filterPoolByHomebrew(await loadItemPool(ctx, opts.campaignId))]);
    }
  }

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

function resolveImportSaveOpts(entry: { source?: string }, importSourceId?: number) {
  if (importSourceId === DDB_HOMEBREW_SOURCE_ID) {
    return { saveAs: 'homebrew' as const };
  }
  if (importSourceId != null && importSourceId > 0) {
    return { saveAs: 'replace' as const };
  }
  return entry.source && entry.source !== 'D&D Beyond' && entry.source !== 'Custom'
    ? { saveAs: 'replace' as const }
    : { saveAs: 'homebrew' as const };
}

function applyHomebrewSource<T extends { source?: string }>(entry: T): T {
  return { ...entry, source: DDB_HOMEBREW_SOURCE_LABEL };
}

async function unlockImportedBookSources(catalog: DdbCatalog, sourceIds: number[]): Promise<string[]> {
  const labels = sourceIds
    .map((sourceId) => catalog.sourceNames.get(sourceId))
    .filter((label): label is string => Boolean(label && label !== 'D&D Beyond'));
  return unlockImportedBookSourceLabels(labels);
}

async function unlockImportedBookSourceLabels(sourceLabels: string[]): Promise<string[]> {
  const labels = [...new Set(sourceLabels)].filter(
    (label) => label && label !== 'D&D Beyond' && label.toLowerCase() !== 'custom',
  );
  if (labels.length === 0) return [];
  try {
    await unlockCompendiumSourcesBulk(labels);
    return labels;
  } catch (err) {
    console.warn(
      '[DDB Import] Could not unlock compendium sources:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

/** Unlock compendium book sources after import — no full catalog reconcile. */
export async function unlockDdbImportedBook(
  ctx: DdbAuthContext,
  sourceId: number,
  sourceName: string | undefined,
  savedEntries: Array<{ source?: string }>,
): Promise<string[]> {
  const catalog = await loadDdbCatalog(ctx);
  const fromIds =
    sourceId > 0 ? await unlockImportedBookSources(catalog, [sourceId]) : [];
  const labels = [
    ...new Set([
      ...(sourceName ? [sourceName] : []),
      ...sourceLabelsFromEntries(savedEntries),
    ]),
  ];
  const fromLabels = await unlockImportedBookSourceLabels(labels);
  return [...new Set([...fromIds, ...fromLabels])];
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

export type DdbImportRunOptions = {
  /** Skip entries already stored in Mongo for the same book (fast reimport). */
  skipExisting?: boolean;
  skipIndex?: ImportSkipIndex;
  /** Monster id → name (from DDB search summaries) for skip checks before fetch. */
  namesById?: Map<number, string>;
  /** Live progress for background import jobs (done/total within current kind). */
  onProgress?: (done: number, total: number) => void;
};

function sourceLabelForBook(catalog: DdbCatalog, sourceId?: number): string {
  if (sourceId === DDB_HOMEBREW_SOURCE_ID) return DDB_HOMEBREW_SOURCE_LABEL;
  if (sourceId == null) return '';
  return catalog.sourceNames.get(sourceId) ?? '';
}

function entityNameFromRaw(raw: Record<string, unknown>): string {
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  return String(def.name ?? raw.name ?? '').trim();
}

function filterIdsBySkipIndex(
  kind: CompendiumKind,
  ids: number[],
  nameById: Map<number, string>,
  skipIndex: ImportSkipIndex,
  sourceLabel: string,
): { ids: number[]; skipped: number } {
  const kept: number[] = [];
  let skipped = 0;
  for (const id of ids) {
    const name = nameById.get(id);
    if (name && skipIndex.has(kind, name, sourceLabel || undefined)) {
      skipped += 1;
      continue;
    }
    kept.push(id);
  }
  return { ids: kept, skipped };
}

async function saveImportBatch<T extends OwlbearMonster | OwlbearItem | OwlbearSpell>(
  kind: 'monster' | 'item' | 'spell',
  pending: Array<{ entry: T; ddbId: number }>,
  saveBulk: (entries: Array<{ entry: T; opts: { saveAs: 'replace' | 'homebrew' } }>) => Promise<{
    entries: Array<{ id: string; name: string; source?: string }>;
    persist: { mongoPersisted: boolean };
  }>,
  imported: DdbLibraryImportResult['imported'],
  errors: DdbLibraryImportResult['errors'],
  meta: ImportBatchMeta,
  importSourceId?: number,
): Promise<void> {
  for (let i = 0; i < pending.length; i += SAVE_BATCH) {
    const slice = pending.slice(i, i + SAVE_BATCH);
    const payloads = slice.map(({ entry }) => ({
      entry,
      opts: resolveImportSaveOpts(entry, importSourceId),
    }));

    try {
      const batch = await saveBulk(payloads);
      meta.mongoPersisted = meta.mongoPersisted && batch.persist.mongoPersisted;
      meta.savedEntries.push(...batch.entries);
      for (let j = 0; j < batch.entries.length; j++) {
        imported.push({
          kind,
          ddbId: slice[j]!.ddbId,
          compendiumId: batch.entries[j]!.id,
          name: batch.entries[j]!.name,
          source: batch.entries[j]!.source,
        });
      }
    } catch (batchErr) {
      const batchMessage = batchErr instanceof Error ? batchErr.message : 'Import failed';
      console.warn(`[DDB Import] ${kind} batch save failed (${slice.length}), trying per-entry:`, batchMessage);
      for (const { entry, ddbId } of slice) {
        try {
          const single = await saveBulk([{ entry, opts: resolveImportSaveOpts(entry, importSourceId) }]);
          meta.mongoPersisted = meta.mongoPersisted && single.persist.mongoPersisted;
          meta.savedEntries.push(...single.entries);
          if (single.entries[0]) {
            imported.push({
              kind,
              ddbId,
              compendiumId: single.entries[0].id,
              name: single.entries[0].name,
              source: single.entries[0].source,
            });
          }
        } catch (err) {
          errors.push({
            id: ddbId,
            message: err instanceof Error ? err.message : batchMessage,
          });
        }
      }
    }
  }
}

async function finalizeDdbImportResult(
  result: DdbLibraryImportResult,
  catalog: DdbCatalog,
  meta: ImportBatchMeta,
  sourceIds?: number[],
  opts?: { skipSourceUnlock?: boolean },
): Promise<DdbLibraryImportResult> {
  if (result.imported.length === 0) return result;

  const unlockedFromIds = !opts?.skipSourceUnlock && sourceIds?.length
    ? await unlockImportedBookSources(catalog, sourceIds)
    : [];
  const unlockedFromLabels = !opts?.skipSourceUnlock
    ? await unlockImportedBookSourceLabels(sourceLabelsFromEntries(meta.savedEntries))
    : [];

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
  runOpts?: DdbImportRunOptions,
): Promise<DdbLibraryImportResult> {
  const imported: DdbLibraryImportResult['imported'] = [];
  const errors: DdbLibraryImportResult['errors'] = [];
  const meta: ImportBatchMeta = { mongoPersisted: true, savedEntries: [] };
  let skipped = 0;
  const skipIndex = runOpts?.skipExisting
    ? (runOpts.skipIndex ?? await loadImportSkipIndex())
    : null;
  const sourceLabel = sourceLabelForBook(catalog, sourceId);
  const nameById = runOpts?.namesById ?? new Map<number, string>();

  for (let i = 0; i < ids.length; i += MONSTER_IMPORT_BATCH) {
    let batchIds = ids.slice(i, i + MONSTER_IMPORT_BATCH);
    if (skipIndex && nameById.size > 0) {
      const filtered = filterIdsBySkipIndex('monster', batchIds, nameById, skipIndex, sourceLabel);
      skipped += filtered.skipped;
      batchIds = filtered.ids;
    }
    if (batchIds.length === 0) {
      runOpts?.onProgress?.(Math.min(i + MONSTER_IMPORT_BATCH, ids.length), ids.length);
      continue;
    }

    const rawById = await fetchMonstersForImport(ctx, batchIds);

    const pending: Array<{ entry: OwlbearMonster; ddbId: number }> = [];

    for (const id of batchIds) {
      try {
        const raw = rawById.get(id);
        if (!raw) {
          errors.push({ id, message: 'Monster not found on D&D Beyond (check account access)' });
          continue;
        }
        if (!ddbMonsterCanImport(raw, catalog)) {
          const desc = String(raw.name ?? '').trim();
          errors.push({
            id,
            message: desc
              ? `No stat block text returned from D&D Beyond for ${desc}`
              : 'No stat block text returned from D&D Beyond',
          });
          continue;
        }
        const withSource = normalizeDdbMonsterToCompendium(raw, catalog, sourceId);
        if (!withSource) {
          errors.push({ id, message: 'Could not parse monster' });
          continue;
        }
        pending.push({
          entry: sourceId === DDB_HOMEBREW_SOURCE_ID
            ? applyHomebrewSource(withSource)
            : applyBookSource(withSource, raw, catalog, sourceId),
          ddbId: id,
        });
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    if (pending.length === 0) continue;

    await saveImportBatch(
      'monster',
      pending,
      (entries) => saveMonstersBulkForImport(entries),
      imported,
      errors,
      meta,
      sourceId,
    );
    runOpts?.onProgress?.(Math.min(i + MONSTER_IMPORT_BATCH, ids.length), ids.length);
  }
  return finalizeDdbImportResult(
    { imported, errors, ...(skipped > 0 ? { skipped } : {}) },
    catalog,
    { mongoPersisted: meta.mongoPersisted, savedEntries: meta.savedEntries },
    sourceId != null ? [sourceId] : undefined,
    { skipSourceUnlock: true },
  );
}

async function importSpellIds(
  ctx: DdbAuthContext,
  ids: number[],
  catalog: DdbCatalog,
  campaignId?: number,
  sourceId?: number,
  runOpts?: DdbImportRunOptions,
): Promise<DdbLibraryImportResult> {
  const imported: DdbLibraryImportResult['imported'] = [];
  const errors: DdbLibraryImportResult['errors'] = [];
  const meta: ImportBatchMeta = { mongoPersisted: true, savedEntries: [] };
  let skipped = 0;
  const skipIndex = runOpts?.skipExisting
    ? (runOpts.skipIndex ?? await loadImportSkipIndex())
    : null;
  const sourceLabel = sourceLabelForBook(catalog, sourceId);
  const pool = await loadSpellPool(ctx, campaignId);
  const byId = poolById(pool);
  const nameById = new Map<number, string>();
  for (const [id, raw] of byId) {
    const name = entityNameFromRaw(raw);
    if (name) nameById.set(id, name);
  }

  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    let batchIds = ids.slice(i, i + FETCH_BATCH);
    if (skipIndex) {
      const filtered = filterIdsBySkipIndex('spell', batchIds, nameById, skipIndex, sourceLabel);
      skipped += filtered.skipped;
      batchIds = filtered.ids;
    }
    if (batchIds.length === 0) {
      runOpts?.onProgress?.(Math.min(i + FETCH_BATCH, ids.length), ids.length);
      continue;
    }

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
        pending.push({
          entry: sourceId === DDB_HOMEBREW_SOURCE_ID
            ? applyHomebrewSource(applyBookSource(entry, raw, catalog, sourceId))
            : applyBookSource(entry, raw, catalog, sourceId),
          ddbId: id,
        });
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    if (pending.length === 0) continue;

    await saveImportBatch(
      'spell',
      pending,
      (entries) => saveSpellsBulkForImport(entries),
      imported,
      errors,
      meta,
      sourceId,
    );
    runOpts?.onProgress?.(Math.min(i + FETCH_BATCH, ids.length), ids.length);
  }
  return finalizeDdbImportResult(
    { imported, errors, ...(skipped > 0 ? { skipped } : {}) },
    catalog,
    { mongoPersisted: meta.mongoPersisted, savedEntries: meta.savedEntries },
    sourceId != null ? [sourceId] : undefined,
    { skipSourceUnlock: true },
  );
}

async function importItemIds(
  ctx: DdbAuthContext,
  ids: number[],
  catalog: DdbCatalog,
  campaignId?: number,
  sourceId?: number,
  runOpts?: DdbImportRunOptions,
): Promise<DdbLibraryImportResult> {
  const imported: DdbLibraryImportResult['imported'] = [];
  const errors: DdbLibraryImportResult['errors'] = [];
  const meta: ImportBatchMeta = { mongoPersisted: true, savedEntries: [] };
  let skipped = 0;
  const skipIndex = runOpts?.skipExisting
    ? (runOpts.skipIndex ?? await loadImportSkipIndex())
    : null;
  const sourceLabel = sourceLabelForBook(catalog, sourceId);
  const pool = await loadItemPool(ctx, campaignId);
  const byId = poolById(pool);
  const nameById = new Map<number, string>();
  for (const [id, raw] of byId) {
    const name = entityNameFromRaw(raw);
    if (name) nameById.set(id, name);
  }

  for (let i = 0; i < ids.length; i += FETCH_BATCH) {
    let batchIds = ids.slice(i, i + FETCH_BATCH);
    if (skipIndex) {
      const filtered = filterIdsBySkipIndex('item', batchIds, nameById, skipIndex, sourceLabel);
      skipped += filtered.skipped;
      batchIds = filtered.ids;
    }
    if (batchIds.length === 0) {
      runOpts?.onProgress?.(Math.min(i + FETCH_BATCH, ids.length), ids.length);
      continue;
    }

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
        pending.push({
          entry: sourceId === DDB_HOMEBREW_SOURCE_ID
            ? applyHomebrewSource(applyBookSource(entry, raw, catalog, sourceId))
            : applyBookSource(entry, raw, catalog, sourceId),
          ddbId: id,
        });
      } catch (err) {
        errors.push({ id, message: err instanceof Error ? err.message : 'Import failed' });
      }
    }

    if (pending.length === 0) continue;

    await saveImportBatch(
      'item',
      pending,
      (entries) => saveItemsBulkForImport(entries),
      imported,
      errors,
      meta,
      sourceId,
    );
    runOpts?.onProgress?.(Math.min(i + FETCH_BATCH, ids.length), ids.length);
  }
  return finalizeDdbImportResult(
    { imported, errors, ...(skipped > 0 ? { skipped } : {}) },
    catalog,
    { mongoPersisted: meta.mongoPersisted, savedEntries: meta.savedEntries },
    sourceId != null ? [sourceId] : undefined,
    { skipSourceUnlock: true },
  );
}


function importFailureForIds(ids: number[], message: string): DdbLibraryImportResult {
  return {
    imported: [],
    errors: ids.map((id) => ({ id, message })),
  };
}

export async function importDdbLibraryEntries(
  ctx: DdbAuthContext,
  opts: {
    kind: 'monster' | 'item' | 'spell';
    ids: number[];
    campaignId?: number;
    sourceId?: number;
    skipExisting?: boolean;
    namesById?: Record<number, string> | Map<number, string>;
  },
): Promise<DdbLibraryImportResult> {
  const ids = [...new Set(opts.ids.filter((id) => Number.isFinite(id) && id > 0))];
  if (ids.length === 0) {
    return { imported: [], errors: [{ id: 0, message: 'No entries selected' }] };
  }

  let catalog: DdbCatalog;
  try {
    catalog = await loadDdbCatalog(ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load D&D Beyond catalog';
    return importFailureForIds(ids, message);
  }

  const namesById = opts.namesById instanceof Map
    ? opts.namesById
    : new Map(Object.entries(opts.namesById ?? {}).map(([k, v]) => [Number(k), v]));
  const runOpts: DdbImportRunOptions | undefined = opts.skipExisting
    ? { skipExisting: true, namesById }
    : undefined;

  if (opts.kind === 'monster') {
    return importMonsterIds(ctx, ids, catalog, opts.sourceId, runOpts);
  }
  if (opts.kind === 'spell') {
    return importSpellIds(ctx, ids, catalog, opts.campaignId, opts.sourceId, runOpts);
  }
  return importItemIds(ctx, ids, catalog, opts.campaignId, opts.sourceId, runOpts);
}

export async function importAllDdbLibraryFromSource(
  ctx: DdbAuthContext,
  opts: {
    kind: 'monster' | 'item' | 'spell';
    sourceId: number;
    campaignId?: number;
    skipExisting?: boolean;
    skipIndex?: ImportSkipIndex;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<DdbLibraryImportResult> {
  if (opts.sourceId === DDB_HOMEBREW_SOURCE_ID) {
    const catalog = await loadDdbCatalog(ctx);
    const runOpts: DdbImportRunOptions | undefined = opts.skipExisting || opts.onProgress
      ? {
          ...(opts.skipExisting ? { skipExisting: true, skipIndex: opts.skipIndex } : {}),
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        }
      : undefined;

    if (opts.kind === 'monster') {
      const summaries: DdbLibraryMonsterSummary[] = [];
      let skip = 0;
      const take = 100;
      while (true) {
        const { items } = await searchDdbMonsters(ctx, {
          sourceIds: [DDB_HOMEBREW_SOURCE_ID],
          skip,
          take,
        });
        if (items.length === 0) break;
        summaries.push(...items);
        skip += items.length;
        if (items.length < take) break;
      }
      const namesById = new Map(summaries.map((m) => [m.ddbId, m.name]));
      opts.onProgress?.(0, summaries.length);
      return importMonsterIds(
        ctx,
        summaries.map((m) => m.ddbId),
        catalog,
        DDB_HOMEBREW_SOURCE_ID,
        { ...runOpts, namesById },
      );
    }

    if (opts.kind === 'spell') {
      const pool = filterPoolByHomebrew(await loadSpellPool(ctx, opts.campaignId));
      const ids = pool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
      return importSpellIds(ctx, ids, catalog, opts.campaignId, DDB_HOMEBREW_SOURCE_ID, runOpts);
    }

    const pool = filterPoolByHomebrew(await loadItemPool(ctx, opts.campaignId));
    const ids = pool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
    return importItemIds(ctx, ids, catalog, opts.campaignId, DDB_HOMEBREW_SOURCE_ID, runOpts);
  }

  const catalog = await loadDdbCatalog(ctx);
  const runOpts: DdbImportRunOptions | undefined = opts.skipExisting || opts.onProgress
    ? {
        ...(opts.skipExisting ? { skipExisting: true, skipIndex: opts.skipIndex } : {}),
        ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
      }
    : undefined;

  if (opts.kind === 'monster') {
    const summaries: DdbLibraryMonsterSummary[] = [];
    let skip = 0;
    const take = 100;
    while (true) {
      const { items, total } = await searchDdbMonsters(ctx, {
        sourceId: opts.sourceId,
        skip,
        take,
      });
      if (items.length === 0) break;
      summaries.push(...items);
      skip += items.length;
      if (items.length < take) break;
      if (Number.isFinite(total) && total > 0 && skip >= total) break;
    }
    const namesById = new Map(summaries.map((m) => [m.ddbId, m.name]));
    opts.onProgress?.(0, summaries.length);
    return importMonsterIds(
      ctx,
      summaries.map((m) => m.ddbId),
      catalog,
      opts.sourceId,
      { ...runOpts, namesById },
    );
  }

  if (opts.kind === 'spell') {
    const pool = filterPoolBySource(await loadSpellPool(ctx, opts.campaignId), opts.sourceId);
    const ids = pool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
    opts.onProgress?.(0, ids.length);
    return importSpellIds(ctx, ids, catalog, opts.campaignId, opts.sourceId, runOpts);
  }

  const pool = filterPoolBySource(await loadItemPool(ctx, opts.campaignId), opts.sourceId);
  const ids = pool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
  opts.onProgress?.(0, ids.length);
  return importItemIds(ctx, ids, catalog, opts.campaignId, opts.sourceId, runOpts);
}

export async function importAllDdbHomebrew(
  ctx: DdbAuthContext,
  opts: {
    campaignId?: number;
    skipExisting?: boolean;
    skipIndex?: ImportSkipIndex;
  },
): Promise<DdbLibraryImportResult> {
  const catalog = await loadDdbCatalog(ctx);
  const runOpts: DdbImportRunOptions | undefined = opts.skipExisting
    ? { skipExisting: true, skipIndex: opts.skipIndex }
    : undefined;

  const summaries: DdbLibraryMonsterSummary[] = [];
  let skip = 0;
  const take = 100;
  while (true) {
    const { items } = await searchDdbMonsters(ctx, {
      sourceIds: [DDB_HOMEBREW_SOURCE_ID],
      skip,
      take,
    });
    if (items.length === 0) break;
    summaries.push(...items);
    skip += items.length;
    if (items.length < take) break;
  }
  const namesById = new Map(summaries.map((m) => [m.ddbId, m.name]));
  const monsterResult = await importMonsterIds(
    ctx,
    summaries.map((m) => m.ddbId),
    catalog,
    DDB_HOMEBREW_SOURCE_ID,
    { ...runOpts, namesById },
  );

  const spellPool = filterPoolByHomebrew(await loadSpellPool(ctx, opts.campaignId));
  const itemPool = filterPoolByHomebrew(await loadItemPool(ctx, opts.campaignId));
  const spellIds = spellPool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);
  const itemIds = itemPool.map((raw) => ddbEntityId(raw)).filter((id): id is number => id != null);

  const [spellResult, itemResult] = await Promise.all([
    importSpellIds(
      ctx,
      spellIds,
      catalog,
      opts.campaignId,
      DDB_HOMEBREW_SOURCE_ID,
      runOpts,
    ),
    importItemIds(
      ctx,
      itemIds,
      catalog,
      opts.campaignId,
      DDB_HOMEBREW_SOURCE_ID,
      runOpts,
    ),
  ]);

  return mergeImportResults(monsterResult, spellResult, itemResult);
}

function mergeImportResults(...parts: DdbLibraryImportResult[]): DdbLibraryImportResult {
  const imported = parts.flatMap((p) => p.imported);
  const errors = parts.flatMap((p) => p.errors);
  const skipped = parts.reduce((sum, p) => sum + (p.skipped ?? 0), 0);
  if (imported.length === 0 && skipped === 0) {
    return { imported, errors };
  }
  return {
    imported,
    errors,
    ...(skipped > 0 ? { skipped } : {}),
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
    skipExisting?: boolean;
  },
): Promise<DdbLibraryImportResult> {
  const unique = [...new Set(opts.sourceIds.filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID)))];
  if (unique.length === 0) {
    return { imported: [], errors: [{ id: 0, message: 'No source books selected' }] };
  }

  const homebrewSelected = unique.includes(DDB_HOMEBREW_SOURCE_ID);
  const books = unique.filter((id) => id > 0);

  const kinds = opts.kinds?.length ? opts.kinds : (['monster', 'spell', 'item'] as const);
  const skipIndex = opts.skipExisting ? await loadImportSkipIndex(true) : undefined;

  const results: DdbLibraryImportResult[] = [];
  if (homebrewSelected) {
    results.push(
      await importAllDdbHomebrew(ctx, {
        campaignId: opts.campaignId,
        ...(opts.skipExisting ? { skipExisting: true, skipIndex } : {}),
      }),
    );
  }
  for (const sourceId of books) {
    const kindResults = await Promise.all(
      kinds.map((kind) =>
        importAllDdbLibraryFromSource(ctx, {
          kind,
          sourceId,
          campaignId: opts.campaignId,
          ...(opts.skipExisting ? { skipExisting: true, skipIndex } : {}),
        }),
      ),
    );
    results.push(...kindResults);
  }
  const merged = mergeImportResults(...results);
  if (merged.imported.length === 0 && !opts.skipExisting) return merged;
  const sourceLabels = sourceLabelsFromEntries(
    merged.imported.map((e) => ({ source: e.source })),
  );
  try {
    const fin = await finishDdbLibraryImport(ctx, {
      sourceIds: books,
      ...(sourceLabels.length > 0 ? { sourceLabels } : {}),
    });
    return {
      ...merged,
      catalogRev: fin.catalogRev ?? merged.catalogRev,
      sourcesUnlocked: [...new Set([...(merged.sourcesUnlocked ?? []), ...(fin.sourcesUnlocked ?? [])])],
    };
  } catch (err) {
    console.warn('[DDB] finish-import after import-all failed:', err);
    return merged;
  }
}

async function collectSourceLabelsFromCompendium(): Promise<string[]> {
  const { readBookSourceLabelsFromMongo } = await import('../compendiumOwlbearPersist');
  const buckets = await readBookSourceLabelsFromMongo();
  const labels = new Set<string>();
  const addSources = (sources: Array<string | undefined>) => {
    for (const source of sources) {
      for (const part of splitCompendiumSources(source)) {
        if (part && part !== 'D&D Beyond' && part.toLowerCase() !== 'custom') {
          labels.add(part);
        }
      }
    }
  };
  if (buckets) {
    addSources(buckets.monsterSources);
    addSources(buckets.itemSources);
    addSources(buckets.spellSources);
  }
  const { readRawGlobalDoc } = await import('../compendiumOwlbearPersist');
  const raw = await readRawGlobalDoc({ includeImageData: false });
  for (const list of [raw.overrideMonsters, raw.overrideItems, raw.overrideSpells]) {
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (!entry || typeof entry !== 'object') continue;
      addSources([String(entry.source ?? '').trim()]);
    }
  }
  return [...labels];
}

function compendiumLabelsForSourceIds(
  catalog: DdbCatalog,
  sourceIds: number[],
  compendiumLabels: string[],
): string[] {
  const targetNames = sourceIds
    .map((id) => catalog.sourceNames.get(id))
    .filter((name): name is string => Boolean(name && name !== 'D&D Beyond'));
  if (targetNames.length === 0) return [];
  return compendiumLabels.filter((label) =>
    targetNames.some((name) => sourceMatchesLocked(name, label) || name === label),
  );
}

export async function finishDdbLibraryImport(
  ctx: DdbAuthContext,
  opts?: {
    sourceIds?: number[];
    sourceLabels?: string[];
    /** Unlock every book source found in saved compendium entries (recovery after interrupted import). */
    unlockAllImportedSources?: boolean;
    /** Wait for catalog rebuild to finish (default: background rebuild). */
    awaitCatalogRebuild?: boolean;
  },
): Promise<{
  catalogRev: string | null;
  sourcesUnlocked?: string[];
  catalogRebuildPending?: boolean;
}> {
  const { collectImportedSourceLabels } = await import('../compendiumBundledLock');
  const unlocked: string[] = [];

  // ensureImportedSourcesUnlocked (inside reconcile) unlocks every override source — only add targeted unlocks.
  const needsTargetedUnlock =
    (opts?.sourceIds?.length || opts?.sourceLabels?.length)
    && !opts?.unlockAllImportedSources;

  if (needsTargetedUnlock) {
    const labelsToUnlock: string[] = [...(opts?.sourceLabels ?? [])];
    if (opts?.sourceIds?.length) {
      const catalog = await loadDdbCatalog(ctx);
      for (const label of await unlockImportedBookSources(catalog, opts.sourceIds)) {
        labelsToUnlock.push(label);
      }
      const compendiumLabels = await collectSourceLabelsFromCompendium();
      labelsToUnlock.push(
        ...compendiumLabelsForSourceIds(catalog, opts.sourceIds, compendiumLabels),
      );
    }
    unlocked.push(...await unlockImportedBookSourceLabels(labelsToUnlock));
  } else {
    unlocked.push(...await collectImportedSourceLabels());
  }

  const { reconcileCompendiumMongo } = await import('../compendiumSync');
  const status = await reconcileCompendiumMongo('ddb-finish-import', {
    deferCatalogRebuild: !opts?.awaitCatalogRebuild,
    strict: false,
  });
  void import('../compendiumSync')
    .then(({ listAllBookSources }) => listAllBookSources())
    .catch(() => undefined);
  return {
    catalogRev: status.catalogRev ?? null,
    sourcesUnlocked: [...new Set(unlocked)],
    catalogRebuildPending: Boolean(status.catalogRebuild?.active),
  };
}
