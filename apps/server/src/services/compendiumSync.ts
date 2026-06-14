import type {
  CompendiumGlobalDoc,
  CompendiumItem,
  CompendiumMonster,
  CompendiumSpell,
  CompendiumSyncStatus,
  CompendiumSaveAs,
  OwlbearItem,
  OwlbearMonster,
  OwlbearRawGlobalDoc,
  OwlbearSpell,
} from '@grimoire/shared';
import { isHomebrewEntry, normalizeOwlbearGlobalDoc, splitCompendiumSources } from '@grimoire/shared';
import { isLikelyValidItem, parseCr, slugify } from '@grimoire/monster-dex';
import {
  deleteCompendiumEntryBySlug,
  getCompendiumStorageHealthSnapshot,
  isCompendiumStorageUnavailable,
  pingCompendiumStorage,
  readPostgresGlobalVersion,
  readTypedImportEntriesFromPostgres,
  upsertTypedImportEntriesBulk,
} from './compendiumPostgres';
import { resolveCompendiumEntryImageUrl, resolveEntryImageUrl } from './compendiumImages';
import {
  isLocalCatalogAvailable,
  loadLocalItems,
  loadLocalMonsters,
  loadLocalSpells,
} from './compendiumLocal';
import { loadGlobalFallback, globalFallbackFileRevision, loadRawGlobalFallback } from './compendiumGlobalFallback';
import { fetchExtensionGlobalDoc, invalidateExtensionGlobalCache, fetchExtensionVersion } from './compendiumExtensionBridge';
import {
  globalDoc,
  readMongoGlobalVersion,
  newestIso,
  isoTimestamp,
} from './compendiumGlobal';
import {
  saveOwlbearEntry,
  deleteOwlbearEntry,
  readRawGlobalDoc,
  saveOwlbearEntriesBulk,
  clearRawGlobalDocInflight,
  type CompendiumKind,
  type PersistRawGlobalDocResult,
} from './compendiumOwlbearPersist';
import {
  buildHiddenBuiltInKeys,
  entryNameKey,
  filterCustomEntries,
  isHiddenBuiltIn,
  namesMatch,
  normalizeOwlbearRawDoc,
} from './compendiumMerge';
import {
  compendiumCatalogMergeKey,
  compendiumContentFingerprint,
  dedupeByBookSlot,
  resolveEntryId,
} from './compendiumEntryIdentity';
import {
  registerCompendiumCacheInvalidator,
  setCachedGlobalLite,
} from './compendiumCache';
import { registerCatalogRebuild } from './compendiumChangeNotify';
import {
  entryMatchesSource,
  isEntryDraft,
  normalizeSourceLabel,
  policyFromRaw,
  policyIsSourceLocked,
  type CompendiumVisibilityPolicy,
} from './compendiumVisibility';
import {
  readOverrideCountsFromMongo,
  readOverrideEntriesFromMongo,
  readOverrideEntryByIdFromMongo,
  readTypedImportOverrideSlices,
  typedImportOverrideCount,
  readOverrideCountsFromTypedCollections,
  collectImportedSourceLabelListFromMongo,
} from './compendiumMongoReads';
import { getCompendiumVisibilityPolicy } from './compendiumSourcePolicy';
import {
  bundledSourceLabelSet,
} from './compendiumBundledLock';
import {
  readVisibilityPolicyFast,
  registerCatalogPolicySink,
} from './compendiumPolicyCache';
import {
  finishCatalogRebuild,
  getCatalogRebuildProgress,
  startCatalogRebuild,
  updateCatalogRebuild,
} from './compendiumCatalogRebuildProgress';

type StoredMonster = OwlbearMonster & { _id: string; isCustom?: boolean };
type StoredItem = OwlbearItem & { _id: string; isCustom?: boolean };
type StoredSpell = OwlbearSpell & { _id: string; isCustom?: boolean };

function toMonster(
  entry: StoredMonster,
  isCustom: boolean,
  global?: CompendiumGlobalDoc,
  lite = false,
): CompendiumMonster {
  const base: CompendiumMonster = {
    id: entry._id,
    name: entry.name,
    type: entry.type,
    source: entry.source,
    hp: entry.hp,
    ac: entry.ac,
    cr: String(entry.cr),
    description: entry.description,
    ...(entry.image ? { image: entry.image } : {}),
    ...(entry.stats ? { stats: entry.stats } : {}),
    isCustom,
  };
  if (global && !lite) {
    const imageUrl = resolveEntryImageUrl(global, 'monster', entry.name, entry.image);
    if (imageUrl) base.imageUrl = imageUrl;
  }
  return base;
}

function mergeMonsters(
  base: StoredMonster[],
  overrides: OwlbearMonster[],
  customs: OwlbearMonster[],
  deleted: string[],
  global?: CompendiumGlobalDoc,
  lite = false,
): CompendiumMonster[] {
  const activeOverrides = dedupeByBookSlot(overrides);
  const activeCustoms = filterCustomEntries('monster', customs, activeOverrides, deleted);
  const hiddenBuiltIns = buildHiddenBuiltInKeys(activeOverrides, deleted);
  const deletedKeys = new Set(deleted.map((d) => entryNameKey(d)));
  const overrideByBook = new Map(
    activeOverrides.map((o) => [compendiumCatalogMergeKey(o.name, o.source), o] as const),
  );
  const contentSeen = new Set<string>();
  const out = new Map<string, CompendiumMonster>();

  const remember = (monster: CompendiumMonster, raw: StoredMonster | OwlbearMonster): void => {
    const fp = compendiumContentFingerprint('monster', raw);
    if (contentSeen.has(fp)) return;
    contentSeen.add(fp);
    out.set(monster.id, monster);
  };

  for (const b of base) {
    if (isHiddenBuiltIn(b.name, hiddenBuiltIns)) continue;
    const bookKey = compendiumCatalogMergeKey(b.name, b.source);
    const ov = overrideByBook.get(bookKey);
    const merged = ov ? { ...b, ...ov, _id: (ov as StoredMonster)._id ?? b._id } : b;
    const entryId = resolveEntryId('monster', merged);
    remember(
      toMonster(
        { ...merged, _id: entryId },
        isHomebrewEntry(Boolean(ov), merged.source),
        global,
        lite,
      ),
      merged,
    );
    if (ov) overrideByBook.delete(bookKey);
  }

  for (const ov of overrideByBook.values()) {
    const entryId = resolveEntryId('monster', ov as StoredMonster);
    remember(
      toMonster(
        { ...ov, _id: entryId } as StoredMonster,
        isHomebrewEntry(true, ov.source),
        global,
        lite,
      ),
      ov,
    );
  }

  for (const c of activeCustoms) {
    if (deletedKeys.has(entryNameKey(c.name))) continue;
    const entryId = resolveEntryId('monster', c as StoredMonster);
    if (out.has(entryId)) continue;
    remember(
      toMonster({ ...c, _id: entryId } as StoredMonster, true, global, lite),
      c,
    );
  }

  return Array.from(out.values());
}

function mergeItems(
  base: StoredItem[],
  overrides: OwlbearItem[],
  customs: OwlbearItem[],
  deleted: string[],
  global?: CompendiumGlobalDoc,
  lite = false,
): CompendiumItem[] {
  const activeOverrides = dedupeByBookSlot(overrides);
  const activeCustoms = filterCustomEntries('item', customs, activeOverrides, deleted);
  const hiddenBuiltIns = buildHiddenBuiltInKeys(activeOverrides, deleted);
  const deletedKeys = new Set(deleted.map((d) => entryNameKey(d)));
  const overrideByBook = new Map(
    activeOverrides.map((o) => [compendiumCatalogMergeKey(o.name, o.source), o] as const),
  );
  const contentSeen = new Set<string>();
  const out = new Map<string, CompendiumItem>();

  const remember = (item: CompendiumItem, raw: StoredItem | OwlbearItem): void => {
    const fp = compendiumContentFingerprint('item', raw);
    if (contentSeen.has(fp)) return;
    contentSeen.add(fp);
    out.set(item.id, item);
  };

  for (const b of base) {
    if (isHiddenBuiltIn(b.name, hiddenBuiltIns)) continue;
    const bookKey = compendiumCatalogMergeKey(b.name, b.source);
    const ov = overrideByBook.get(bookKey);
    const merged = ov ? { ...b, ...ov, _id: (ov as StoredItem)._id ?? b._id } : b;
    const entryId = resolveEntryId('item', merged);
    const item: CompendiumItem = {
      id: entryId,
      name: merged.name,
      type: merged.type,
      source: merged.source,
      description: merged.description,
      ...(merged.rarity ? { rarity: merged.rarity } : {}),
      ...(merged.flavor ? { flavor: merged.flavor } : {}),
      ...(merged.details ? { details: merged.details } : {}),
      ...(merged.image ? { image: merged.image } : {}),
      isCustom: isHomebrewEntry(Boolean(ov ?? b.isCustom), merged.source),
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'item', merged.name, merged.image);
      if (imageUrl) item.imageUrl = imageUrl;
    }
    remember(item, merged);
    if (ov) overrideByBook.delete(bookKey);
  }

  for (const ov of overrideByBook.values()) {
    const entryId = resolveEntryId('item', ov as StoredItem);
    const item: CompendiumItem = {
      id: entryId,
      ...ov,
      isCustom: isHomebrewEntry(true, ov.source),
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'item', ov.name, ov.image);
      if (imageUrl) item.imageUrl = imageUrl;
    }
    remember(item, ov);
  }

  for (const c of activeCustoms) {
    if (deletedKeys.has(entryNameKey(c.name))) continue;
    const entryId = resolveEntryId('item', c as StoredItem);
    if (out.has(entryId)) continue;
    const item: CompendiumItem = {
      id: entryId,
      ...c,
      isCustom: true,
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'item', c.name, c.image);
      if (imageUrl) item.imageUrl = imageUrl;
    }
    remember(item, c);
  }

  return Array.from(out.values());
}

function mergeSpells(
  base: StoredSpell[],
  overrides: OwlbearSpell[],
  customs: OwlbearSpell[],
  deleted: string[],
  global?: CompendiumGlobalDoc,
  lite = false,
): CompendiumSpell[] {
  const activeOverrides = dedupeByBookSlot(overrides);
  const activeCustoms = filterCustomEntries('spell', customs, activeOverrides, deleted);
  const hiddenBuiltIns = buildHiddenBuiltInKeys(activeOverrides, deleted);
  const deletedKeys = new Set(deleted.map((d) => entryNameKey(d)));
  const overrideByBook = new Map(
    activeOverrides.map((o) => [compendiumCatalogMergeKey(o.name, o.source), o] as const),
  );
  const contentSeen = new Set<string>();
  const out = new Map<string, CompendiumSpell>();

  const remember = (spell: CompendiumSpell, raw: StoredSpell | OwlbearSpell): void => {
    const fp = compendiumContentFingerprint('spell', raw);
    if (contentSeen.has(fp)) return;
    contentSeen.add(fp);
    out.set(spell.id, spell);
  };

  for (const b of base) {
    if (isHiddenBuiltIn(b.name, hiddenBuiltIns)) continue;
    const bookKey = compendiumCatalogMergeKey(b.name, b.source);
    const ov = overrideByBook.get(bookKey);
    const merged = ov ? { ...b, ...ov, _id: (ov as StoredSpell)._id ?? b._id } : b;
    const entryId = resolveEntryId('spell', merged);
    const spell: CompendiumSpell = {
      id: entryId,
      name: merged.name,
      level: merged.level,
      ...(merged.damage ? { damage: merged.damage } : {}),
      ...(merged.type ? { type: merged.type } : {}),
      ...(merged.save ? { save: merged.save } : {}),
      ...(merged.aoe ? { aoe: merged.aoe } : {}),
      ...(merged.attack !== undefined ? { attack: merged.attack } : {}),
      ...(merged.secondary ? { secondary: merged.secondary } : {}),
      ...(merged.description ? { description: merged.description } : {}),
      ...(merged.source ? { source: merged.source } : {}),
      isCustom: isHomebrewEntry(Boolean(ov ?? b.isCustom), merged.source),
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'spell', merged.name, undefined);
      if (imageUrl) spell.imageUrl = imageUrl;
    }
    remember(spell, merged);
    if (ov) overrideByBook.delete(bookKey);
  }

  for (const ov of overrideByBook.values()) {
    const entryId = resolveEntryId('spell', ov as StoredSpell);
    const spell: CompendiumSpell = {
      id: entryId,
      ...ov,
      isCustom: isHomebrewEntry(true, ov.source),
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'spell', ov.name, undefined);
      if (imageUrl) spell.imageUrl = imageUrl;
    }
    remember(spell, ov);
  }

  for (const c of activeCustoms) {
    if (deletedKeys.has(entryNameKey(c.name))) continue;
    const entryId = resolveEntryId('spell', c as StoredSpell);
    if (out.has(entryId)) continue;
    const spell: CompendiumSpell = {
      id: entryId,
      ...c,
      isCustom: true,
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'spell', c.name, undefined);
      if (imageUrl) spell.imageUrl = imageUrl;
    }
    remember(spell, c);
  }

  return Array.from(out.values());
}

function filterMonsters(list: CompendiumMonster[], q: string, crMin?: number, crMax?: number): CompendiumMonster[] {
  const lower = q.trim().toLowerCase();
  return list.filter((m) => {
    if (lower && !m.name.toLowerCase().includes(lower) && !m.description.toLowerCase().includes(lower)) {
      return false;
    }
    const cr = parseCr(m.cr);
    if (crMin !== undefined && cr < crMin) return false;
    if (crMax !== undefined && cr > crMax) return false;
    return true;
  });
}

function paginate<T>(list: T[], page: number, limit: number) {
  const start = (page - 1) * limit;
  return {
    items: list.slice(start, start + limit),
    total: list.length,
    page,
    limit,
  };
}

async function filterCachedEntriesBySource<T extends { source?: string; name: string }>(
  kind: CompendiumKind,
  _load: () => Promise<T[]>,
  sourceFilter: string,
  policy: CompendiumVisibilityPolicy,
  includeDrafts: boolean,
): Promise<T[]> {
  // Books tab: list every stored row for this source — not the deduped "All" catalog.
  let fromStorage: T[];
  if (kind === 'monster') {
    fromStorage = (await monstersFromRawOverrides(sourceFilter, policy)) as unknown as T[];
  } else if (kind === 'item') {
    fromStorage = (await itemsFromRawOverrides(sourceFilter, policy)) as unknown as T[];
  } else {
    fromStorage = (await spellsFromRawOverrides(sourceFilter, policy)) as unknown as T[];
  }
  return filterVisible(kind, fromStorage, policy, includeDrafts);
}

/** Prefer fast local JSON catalog; Postgres is fallback when bundled files are absent. */
async function loadBaseMonsters(): Promise<StoredMonster[]> {
  const local = loadLocalMonsters();
  if (local.length > 0) return local;
  try {
    const rows = await readTypedImportEntriesFromPostgres('monster');
    return rows.map((entry) => ({ ...entry, _id: slugify(entry.name) })) as StoredMonster[];
  } catch {
    return loadLocalMonsters();
  }
}

async function loadBaseItems(): Promise<StoredItem[]> {
  const local = loadLocalItems();
  if (local.length > 0) return local;
  try {
    const rows = await readTypedImportEntriesFromPostgres('item');
    return rows.map((entry) => ({ ...entry, _id: slugify(entry.name) })) as StoredItem[];
  } catch {
    return loadLocalItems();
  }
}

async function loadBaseSpells(): Promise<StoredSpell[]> {
  const local = loadLocalSpells();
  if (local.length > 0) return local;
  try {
    const rows = await readTypedImportEntriesFromPostgres('spell');
    return rows.map((entry) => ({ ...entry, _id: slugify(entry.name) })) as StoredSpell[];
  } catch {
    return loadLocalSpells();
  }
}

type CatalogCache = {
  rev: string;
  policy: CompendiumVisibilityPolicy;
  monsters: CompendiumMonster[];
  items: CompendiumItem[];
  spells: CompendiumSpell[];
};

let catalogCache: CatalogCache | null = null;
let catalogBuildPromise: Promise<CatalogCache> | null = null;
let syncStatusCache: { at: number; value: CompendiumSyncStatus } | null = null;
let overrideCheckCache: { at: number; missing: boolean } | null = null;

type BookSourceCountsCache = {
  rev: string;
  byKind: Record<'monsters' | 'items' | 'spells', SourceCountMap>;
};

let bookSourceCountsCache: BookSourceCountsCache | null = null;

/** Don't block HTTP handlers on a full catalog rebuild (Render request timeout). */
const CATALOG_API_WAIT_MS = 4_000;

function refreshBookSourceCountsCache(cache: CatalogCache): void {
  const bundled = bundledSourceLabelSet();
  const byKind: BookSourceCountsCache['byKind'] = {
    monsters: new Map(),
    items: new Map(),
    spells: new Map(),
  };
  const specs: Array<{
    tab: 'monsters' | 'items' | 'spells';
    compKind: CompendiumKind;
    entries: Array<{ name: string; source?: string }>;
  }> = [
    { tab: 'monsters', compKind: 'monster', entries: cache.monsters },
    { tab: 'items', compKind: 'item', entries: cache.items },
    { tab: 'spells', compKind: 'spell', entries: cache.spells },
  ];
  for (const { tab, compKind, entries } of specs) {
    const visible = filterVisible(compKind, entries as never, cache.policy, true);
    const bookEntries = visible.filter((entry) => entryHasImportedBookSource(entry.source, bundled));
    byKind[tab] = tallyBooksSourceCountsForKind(bookEntries, compKind, cache.policy);
  }
  bookSourceCountsCache = { rev: cache.rev, byKind };
}

async function tallyBookSourceCountsFromPostgres(
  kind: 'monsters' | 'items' | 'spells',
  policy: CompendiumVisibilityPolicy,
  counts: SourceCountMap = new Map(),
): Promise<SourceCountMap> {
  const compendiumKind = kindToCompendiumKind(kind);
  const { readImportedNameSourceRowsForBooks } = await import('./compendiumPostgres');
  const imported = await readImportedNameSourceRowsForBooks();
  return tallyBooksSourceCountsForKind(imported[compendiumKind], compendiumKind, policy, counts);
}

async function resolveBookSourceCountsForKind(
  kind: 'monsters' | 'items' | 'spells',
  policy: CompendiumVisibilityPolicy,
  counts: SourceCountMap = new Map(),
): Promise<SourceCountMap> {
  // Book counts must reflect every imported row per source, not deduped catalog entries.
  return tallyBookSourceCountsFromPostgres(kind, policy, counts);
}

async function raceCatalogBuild<T>(pick: (cache: CatalogCache) => T, fallback: () => Promise<T>): Promise<T> {
  if (catalogCache) return pick(catalogCache);
  if (catalogBuildPromise) {
    const raced = await Promise.race([
      catalogBuildPromise.then(pick),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CATALOG_API_WAIT_MS)),
    ]);
    if (raced != null) return raced;
    return fallback();
  }
  return pick(await buildCatalogCache());
}

function catalogEntryCount(cache: CatalogCache): number {
  return cache.monsters.length + cache.items.length + cache.spells.length;
}

function invalidateCatalogCache(): void {
  catalogCache = null;
  catalogBuildPromise = null;
  overrideCheckCache = null;
  bookSourceCountsCache = null;
}

function invalidateSyncStatusCache(): void {
  syncStatusCache = null;
}

export function bumpCompendiumSyncStatusCache(): void {
  invalidateSyncStatusCache();
}

function rawOverrideCount(raw: {
  overrideMonsters?: unknown[];
  overrideItems?: unknown[];
  overrideSpells?: unknown[];
}): number {
  return (raw.overrideMonsters?.length ?? 0)
    + (raw.overrideItems?.length ?? 0)
    + (raw.overrideSpells?.length ?? 0);
}

async function augmentRawWithTypedImports(
  raw: Awaited<ReturnType<typeof readRawGlobalDoc>>,
): Promise<Awaited<ReturnType<typeof readRawGlobalDoc>>> {
  const typed = await readTypedImportOverrideSlices();
  const typedCount = typedImportOverrideCount(typed);
  if (typedCount === 0) return raw;

  const globalCount = rawOverrideCount(raw);
  if (typedCount > globalCount) {
    console.warn(
      `[Compendium] Typed import collections have ${typedCount} entries vs ${globalCount} in global doc — merging for catalog/books`,
    );
  }

  const mergeList = <T extends { name: string; source?: string; _id?: string }>(
    global: T[] | undefined,
    typedList: T[],
  ): T[] => {
    const map = new Map<string, T>();
    const keyOf = (entry: T) =>
      entry._id?.trim() || compendiumCatalogMergeKey(entry.name, entry.source);
    for (const entry of global ?? []) {
      if (entry?.name) map.set(keyOf(entry), entry);
    }
    for (const entry of typedList) {
      if (entry?.name) map.set(keyOf(entry), entry);
    }
    return Array.from(map.values());
  };
  return {
    ...raw,
    overrideMonsters: mergeList(raw.overrideMonsters, typed.overrideMonsters),
    overrideItems: mergeList(raw.overrideItems, typed.overrideItems),
    overrideSpells: mergeList(raw.overrideSpells, typed.overrideSpells),
  };
}

async function buildCatalogCacheFromRaw(
  raw: Awaited<ReturnType<typeof readRawGlobalDoc>>,
  revSuffix?: string,
): Promise<CatalogCache> {
  const importCounts = {
    monsters: raw.overrideMonsters?.length ?? 0,
    items: raw.overrideItems?.length ?? 0,
    spells: raw.overrideSpells?.length ?? 0,
  };
  updateCatalogRebuild({
    phase: 'merging-imports',
    label: `Merging ${(importCounts.monsters + importCounts.items + importCounts.spells).toLocaleString()} imported entries…`,
    percent: 15,
    importCounts,
    clearEntryCounts: true,
  });
  const global = normalizeOwlbearGlobalDoc({
    ...raw,
    images: {},
    imagesData: {},
    entryImages: {},
  });
  setCachedGlobalLite(global);
  const effectiveRev = isoTimestamp(global.lastUpdated);
  const deleted = raw.deleted ?? [];
  const policy = policyFromRaw(raw);

  updateCatalogRebuild({
    phase: 'building-monsters',
    label: `Building monster index (${importCounts.monsters.toLocaleString()} imports)…`,
    percent: 25,
  });
  const [baseMonsters, baseItems, baseSpells] = await Promise.all([
    loadBaseMonsters(),
    loadBaseItems(),
    loadBaseSpells(),
  ]);

  const [monsters, items, spells] = await Promise.all([
    Promise.resolve(mergeMonsters(
      baseMonsters,
      raw.overrideMonsters ?? [],
      raw.monsters ?? [],
      deleted,
      global,
      true,
    )),
    Promise.resolve(mergeItems(
      baseItems,
      raw.overrideItems ?? [],
      raw.items ?? [],
      deleted,
      global,
      true,
    )),
    Promise.resolve(mergeSpells(
      baseSpells,
      raw.overrideSpells ?? [],
      raw.spells ?? [],
      deleted,
      global,
      true,
    )),
  ]);

  updateCatalogRebuild({
    phase: 'building-spells',
    label: `Building spell index (${importCounts.spells.toLocaleString()} imports)…`,
    percent: 75,
    entryCounts: { monsters: monsters.length, items: items.length },
  });

  updateCatalogRebuild({
    phase: 'sorting',
    label: 'Sorting catalog…',
    percent: 92,
    entryCounts: { monsters: monsters.length, items: items.length, spells: spells.length },
  });
  monsters.sort((a, b) => a.name.localeCompare(b.name));
  items.sort((a, b) => a.name.localeCompare(b.name));
  spells.sort((a, b) => a.name.localeCompare(b.name));
  const suffix = revSuffix ? `:${revSuffix}` : '';
  return {
    rev: `${effectiveRev}:${policyCacheRev(policy)}${suffix}`,
    policy,
    monsters,
    items,
    spells,
  };
}

async function executeCatalogBuild(previousCache: CatalogCache | null): Promise<CatalogCache> {
  try {
    updateCatalogRebuild({
      phase: 'loading-data',
      label: 'Loading compendium data from database…',
      percent: 5,
    });
    const raw = await readRawGlobalDoc({ includeImageData: false, skipImageMaps: true });
    let built = await buildCatalogCacheFromRaw(raw);

    const rawFallback = loadRawGlobalFallback();
    if (rawFallback) {
      const normalizedFallback = normalizeOwlbearRawDoc(rawFallback);
      if (rawOverrideCount(normalizedFallback) > rawOverrideCount(raw)) {
        updateCatalogRebuild({
          phase: 'verifying',
          label: 'Merging local fallback data…',
          percent: 94,
        });
        const { mergeRawGlobalDocs } = await import('./compendiumFallbackMongoSync');
        const merged = mergeRawGlobalDocs(raw, normalizedFallback);
        const mergedBuilt = await buildCatalogCacheFromRaw(merged, 'merged-fallback');
        if (catalogEntryCount(mergedBuilt) >= catalogEntryCount(built)) {
          built = mergedBuilt;
        }
      } else if (
        catalogEntryCount(built) === 0
        && rawOverrideCount(normalizedFallback) > 0
      ) {
        updateCatalogRebuild({
          phase: 'fallback',
          label: 'Using local fallback file…',
          percent: 94,
        });
        const fallbackBuilt = await buildCatalogCacheFromRaw(normalizedFallback, 'raw-fallback');
        if (catalogEntryCount(fallbackBuilt) > 0) {
          console.warn('[Compendium] Primary rebuild empty — using local fallback file');
          built = fallbackBuilt;
        }
      }
    }

    if (catalogEntryCount(built) === 0 && rawOverrideCount(raw) > 0) {
      console.warn('[Compendium] Rebuild empty despite Mongo overrides — retrying raw build');
      updateCatalogRebuild({
        phase: 'verifying',
        label: 'Retrying catalog build…',
        percent: 96,
      });
      built = await buildCatalogCacheFromRaw(raw, 'override-retry');
    }

    if (
      catalogEntryCount(built) === 0
      && previousCache
      && catalogEntryCount(previousCache) > 0
    ) {
      console.warn('[Compendium] Rebuild produced empty catalog — keeping previous cache');
      return previousCache;
    }
    return built;
  } catch (err) {
    console.warn(
      '[Compendium] Catalog build failed, using local fallback:',
      err instanceof Error ? err.message : err,
    );
    updateCatalogRebuild({
      phase: 'fallback',
      label: 'Recovering from fallback data…',
      percent: 50,
    });
    const rawFallback = loadRawGlobalFallback();
    if (rawFallback) {
      const fallbackBuilt = await buildCatalogCacheFromRaw(rawFallback, 'raw-fallback');
      if (
        catalogEntryCount(fallbackBuilt) === 0
        && previousCache
        && catalogEntryCount(previousCache) > 0
      ) {
        console.warn('[Compendium] Raw fallback rebuild empty — keeping previous cache');
        return previousCache;
      }
      if (catalogEntryCount(fallbackBuilt) > 0) return fallbackBuilt;
    }

    const fallback = loadGlobalFallback(true);
    const global: CompendiumGlobalDoc = fallback ?? {
      _id: 'global',
      monsters: [],
      items: [],
      spells: [],
      deleted: [],
      images: {},
      imagesData: {},
      entryImages: {},
      lastUpdated: new Date(0).toISOString(),
    };
    const policy = await readVisibilityPolicyFast();
    const deleted = global.deleted ?? [];
    const [monsters, items, spells] = await Promise.all([
      mergeMonsters(await loadBaseMonsters(), [], [], deleted, global, true),
      mergeItems(await loadBaseItems(), [], [], deleted, global, true),
      mergeSpells(await loadBaseSpells(), [], [], deleted, global, true),
    ]);
    monsters.sort((a, b) => a.name.localeCompare(b.name));
    items.sort((a, b) => a.name.localeCompare(b.name));
    spells.sort((a, b) => a.name.localeCompare(b.name));
    const built: CatalogCache = {
      rev: `${isoTimestamp(global.lastUpdated)}:${policyCacheRev(policy)}:fallback`,
      policy,
      monsters,
      items,
      spells,
    };
    if (
      catalogEntryCount(built) === 0
      && previousCache
      && catalogEntryCount(previousCache) > 0
    ) {
      console.warn('[Compendium] Fallback rebuild empty — keeping previous cache');
      return previousCache;
    }
    return built;
  }
}

let catalogRebuildInflight: Promise<CatalogCache> | null = null;

/** Rebuild catalog after a write while keeping the previous cache if rebuild fails. */
export async function rebuildCatalogCacheAtomic(): Promise<CatalogCache> {
  // Coalesce concurrent rebuilds (e.g. background change-notify + an explicit post-import
  // rebuild) so they share one pass instead of racing to overwrite the catalog cache.
  if (catalogRebuildInflight) return catalogRebuildInflight;

  catalogRebuildInflight = (async () => {
    const previousCache = catalogCache;
    catalogBuildPromise = null;

    const [mongoCounts, typedCounts] = await Promise.all([
      readOverrideCountsFromMongo(),
      readOverrideCountsFromTypedCollections(),
    ]);
    const pickCounts = (
      a: { monsters: number; items: number; spells: number } | null,
      b: typeof a,
    ) => {
      if (!a) return b ?? undefined;
      if (!b) return a;
      const aTotal = a.monsters + a.items + a.spells;
      const bTotal = b.monsters + b.items + b.spells;
      return bTotal > aTotal ? b : a;
    };
    startCatalogRebuild(pickCounts(mongoCounts, typedCounts));

    try {
      const built = await executeCatalogBuild(previousCache);
      catalogCache = built;
      invalidateSyncStatusCache();
      return built;
    } finally {
      finishCatalogRebuild(getCatalogEntryCounts() ?? undefined);
    }
  })();

  try {
    return await catalogRebuildInflight;
  } finally {
    catalogRebuildInflight = null;
  }
}

export function getCatalogRevision(): string | null {
  return catalogCache?.rev ?? null;
}

export function getCatalogEntryCounts(): { monsters: number; items: number; spells: number } | null {
  if (!catalogCache) return null;
  return {
    monsters: catalogCache.monsters.length,
    items: catalogCache.items.length,
    spells: catalogCache.spells.length,
  };
}

function policyCacheRev(policy: CompendiumVisibilityPolicy): string {
  return `${policy.lockedSources.join('\0')}::${policy.publishedEntryKeys.join('\0')}`;
}

export function applyVisibilityPolicyUpdate(
  policy: CompendiumVisibilityPolicy,
  lastUpdated: string,
): void {
  if (catalogCache) {
    catalogCache = {
      ...catalogCache,
      policy,
      rev: `${lastUpdated}:${policyCacheRev(policy)}`,
    };
  }
}

registerCatalogPolicySink({
  patch: applyVisibilityPolicyUpdate,
});

async function catalogIsMissingOverrides(): Promise<boolean> {
  if (!catalogCache) return true;
  try {
    const counts = await readOverrideCountsFromMongo();
    if (!counts) return catalogEntryCount(catalogCache) === 0;
    const overrideCount = counts.monsters + counts.items + counts.spells;
    if (overrideCount === 0) return false;
    return catalogEntryCount(catalogCache) < Math.min(overrideCount, 200);
  } catch {
    return true;
  }
}

async function ensureCatalogIncludesOverrides(): Promise<void> {
  if (catalogBuildPromise && !catalogCache) return;
  const now = Date.now();
  if (overrideCheckCache && now - overrideCheckCache.at < 30_000 && !overrideCheckCache.missing) {
    return;
  }
  const missing = await catalogIsMissingOverrides();
  overrideCheckCache = { at: now, missing };
  if (!missing) return;
  console.warn('[Compendium] Catalog cache missing Mongo overrides — rebuilding');
  await rebuildCatalogCacheAtomic();
}

async function buildCatalogCache(): Promise<CatalogCache> {
  const version = await readMongoGlobalVersion();
  const versionRev = version ?? '';
  if (catalogCache && versionRev && catalogCache.rev.startsWith(`${versionRev}:`)) {
    if (!(await catalogIsMissingOverrides())) return catalogCache;
  }
  if (catalogBuildPromise) return catalogBuildPromise;

  catalogBuildPromise = (async () => {
    const previousCache = catalogCache;
    try {
      const built = await executeCatalogBuild(previousCache);
      catalogCache = built;
      refreshBookSourceCountsCache(built);
      return catalogCache;
    } finally {
      catalogBuildPromise = null;
    }
  })();

  return catalogBuildPromise;
}

async function getCachedMonsters(): Promise<CompendiumMonster[]> {
  return raceCatalogBuild(
    (cache) => cache.monsters,
    async () => {
      const policy = await getCatalogPolicy();
      const list = await monstersFromRawOverrides(undefined, policy);
      if (list.length > 0) return filterVisible('monster', list, policy, false);
      return loadLocalMonsters().map((b) => toMonster(b, false, undefined, true));
    },
  );
}

async function getCachedItems(): Promise<CompendiumItem[]> {
  return raceCatalogBuild(
    (cache) => cache.items,
    async () => {
      const policy = await getCatalogPolicy();
      const list = await itemsFromRawOverrides(undefined, policy);
      if (list.length > 0) return filterVisible('item', list, policy, false);
      return loadLocalItems().map((b) => ({
        id: b._id,
        name: b.name,
        type: b.type,
        source: b.source,
        description: b.description,
        isCustom: false,
      }));
    },
  );
}

async function getCachedSpells(): Promise<CompendiumSpell[]> {
  return raceCatalogBuild(
    (cache) => cache.spells,
    async () => {
      const policy = await getCatalogPolicy();
      const list = await spellsFromRawOverrides(undefined, policy);
      if (list.length > 0) return filterVisible('spell', list, policy, false);
      return loadLocalSpells().map((b) => ({
        id: b._id,
        name: b.name,
        level: b.level,
        ...(b.source ? { source: b.source } : {}),
        isCustom: false,
      }));
    },
  );
}

async function getCatalogPolicy(): Promise<CompendiumVisibilityPolicy> {
  if (catalogCache) return catalogCache.policy;
  return readVisibilityPolicyFast();
}

function markDraft<T extends { isDraft?: boolean }>(
  kind: CompendiumKind,
  entry: T & { name: string; source?: string },
  policy: CompendiumVisibilityPolicy,
): T {
  if (isEntryDraft(kind, entry.name, entry.source, policy)) {
    return { ...entry, isDraft: true };
  }
  return entry;
}

function filterVisible<T extends { name: string; source?: string; isDraft?: boolean }>(
  kind: CompendiumKind,
  entries: T[],
  policy: CompendiumVisibilityPolicy,
  includeDrafts: boolean,
): T[] {
  const marked = entries.map((e) => markDraft(kind, e, policy));
  if (includeDrafts) return marked;
  return marked.filter((e) => !e.isDraft);
}

function sourceIsLocked(sourceId: string, policy: CompendiumVisibilityPolicy): boolean {
  return policyIsSourceLocked(sourceId, policy);
}

type SourceCountMap = Map<string, { total: number; public: number; draft: number }>;

function tallySourceCounts(
  entries: Array<{ name: string; source?: string; isCustom?: boolean }>,
  kind: CompendiumKind,
  policy: CompendiumVisibilityPolicy,
  counts: SourceCountMap = new Map(),
): SourceCountMap {
  for (const entry of entries) {
    if (isHomebrewEntry(Boolean(entry.isCustom), entry.source)) continue;
    const draft = isEntryDraft(kind, entry.name, entry.source, policy);
    for (const part of splitSources(entry.source)) {
      if (part.toLowerCase() === 'custom') continue;
      const cur = counts.get(part) ?? { total: 0, public: 0, draft: 0 };
      cur.total += 1;
      if (draft) cur.draft += 1;
      else cur.public += 1;
      counts.set(part, cur);
    }
  }
  return counts;
}

function mapSourceListResults(
  counts: SourceCountMap,
  policy: CompendiumVisibilityPolicy,
  includeDrafts: boolean,
  excludeBundled: boolean,
  bundled: Set<string> | null,
) {
  return Array.from(counts.entries())
    .filter(([id, c]) => sourceListFilter(id, c, policy, includeDrafts, excludeBundled, bundled))
    .map(([id, c]) => ({
      id,
      label: formatSourceLabel(id),
      // Books tab: show all imported override entries per source (incl. locked/draft).
      count: excludeBundled ? c.total : (includeDrafts ? c.total : c.public),
      ...(sourceIsLocked(id, policy) ? { locked: true } : {}),
      ...(c.draft > 0 ? { draftCount: c.draft } : {}),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

async function loadEntriesForSourceList(
  kind: 'monsters' | 'items' | 'spells',
  excludeBundled: boolean,
): Promise<Array<{ name: string; source?: string; isCustom?: boolean }>> {
  if (!excludeBundled) {
    if (kind === 'monsters') return getCachedMonsters();
    if (kind === 'items') return getCachedItems();
    return getCachedSpells();
  }

  const compendiumKind = kindToCompendiumKind(kind);
  const overrides = await readOverrideEntriesFromMongo(compendiumKind);
  return overrides.map((entry) => ({ ...entry, isCustom: true }));
}

function kindToCompendiumKind(kind: 'monsters' | 'items' | 'spells'): CompendiumKind {
  if (kind === 'monsters') return 'monster';
  if (kind === 'items') return 'item';
  return 'spell';
}

function tallyBooksSourceCountsForKind(
  entries: Array<{ name: string; source?: string }>,
  kind: CompendiumKind,
  policy: CompendiumVisibilityPolicy,
  counts: SourceCountMap = new Map(),
): SourceCountMap {
  for (const entry of entries) {
    const parts = splitSources(entry.source);
    const labels = parts.length > 0 ? parts : ['D&D Beyond'];
    for (const part of labels) {
      const draft = isEntryDraft(kind, entry.name, entry.source, policy);
      const cur = counts.get(part) ?? { total: 0, public: 0, draft: 0 };
      cur.total += 1;
      if (draft) cur.draft += 1;
      else cur.public += 1;
      counts.set(part, cur);
    }
  }
  return counts;
}

function entryHasImportedBookSource(source: string | undefined, bundled: Set<string>): boolean {
  const parts = splitSources(source);
  if (parts.length === 0) return false;
  return parts.some((part) => {
    const norm = normalizeSourceLabel(part);
    if (!norm || norm === 'custom') return false;
    return !bundled.has(norm);
  });
}

/** Book counts from merged catalog — matches what players see when opening a source. */
async function tallyBookSourceCountsFromCatalog(
  kind: 'monsters' | 'items' | 'spells',
  policy: CompendiumVisibilityPolicy,
  counts: SourceCountMap = new Map(),
): Promise<SourceCountMap> {
  return resolveBookSourceCountsForKind(kind, policy, counts);
}

function tallyBooksSourceCounts(
  raw: Awaited<ReturnType<typeof readRawGlobalDoc>>,
  policy: CompendiumVisibilityPolicy,
): SourceCountMap {
  let counts: SourceCountMap = new Map();
  counts = tallyBooksSourceCountsForKind(raw.overrideMonsters ?? [], 'monster', policy, counts);
  counts = tallyBooksSourceCountsForKind(raw.overrideItems ?? [], 'item', policy, counts);
  counts = tallyBooksSourceCountsForKind(raw.overrideSpells ?? [], 'spell', policy, counts);
  return counts;
}

/** Merged DDB-imported book list (monsters + items + spells) for Compendium → Books. */
export async function listAllBookSources(): Promise<
  Array<{ id: string; label: string; count: number; locked?: boolean; draftCount?: number }>
> {
  const {
    loadPersistedBookSources,
    savePersistedBookSources,
  } = await import('./compendiumBookSourcesCache');

  const policy = await readVisibilityPolicyFast();
  let counts: SourceCountMap = new Map();

  for (const kind of ['monsters', 'items', 'spells'] as const) {
    counts = await tallyBookSourceCountsFromCatalog(kind, policy, counts);
  }

  // Local data.json mirror when catalog has no imported books yet.
  if (counts.size === 0) {
    const rawFallback = loadRawGlobalFallback();
    if (rawFallback) {
      counts = tallyBooksSourceCounts(rawFallback, policy);
    }
  }

  if (counts.size === 0) {
    const { loadImportSkipIndex } = await import('./compendiumImportIndex');
    const index = await loadImportSkipIndex();
    for (const kind of ['monster', 'item', 'spell'] as const) {
      counts = tallyBooksSourceCountsForKind(
        index.rowsForKind(kind).map((row) => ({ name: row.name, source: row.source })),
        kind,
        policy,
        counts,
      );
    }
  }

  if (counts.size === 0) {
    const labels = await collectImportedSourceLabelListFromMongo();
    for (const label of labels) {
      if (!counts.has(label)) {
        counts.set(label, { total: 1, public: 1, draft: 0 });
      }
    }
  }

  const result = mapSourceListResults(
    counts,
    policy,
    true,
    true,
    null,
  );

  if (result.length > 0) {
    savePersistedBookSources(result);
  } else {
    const persisted = loadPersistedBookSources();
    if (persisted) return persisted;
  }

  return result;
}

function compendiumMonsterFromOverride(
  m: OwlbearMonster,
  _policy?: CompendiumVisibilityPolicy,
): CompendiumMonster | null {
  const entryId = resolveEntryId('monster', m as StoredMonster);
  return toMonster(
    { ...m, _id: entryId } as StoredMonster,
    true,
    undefined,
    true,
  );
}

function compendiumItemFromOverride(
  i: OwlbearItem,
  _policy?: CompendiumVisibilityPolicy,
): CompendiumItem | null {
  const entryId = resolveEntryId('item', i as StoredItem);
  return {
    id: entryId,
    name: i.name,
    type: i.type,
    source: i.source,
    description: i.description,
    isCustom: true,
    ...(i.rarity ? { rarity: i.rarity } : {}),
    ...(i.flavor ? { flavor: i.flavor } : {}),
    ...(i.details ? { details: i.details } : {}),
  };
}

function compendiumSpellFromOverride(
  s: OwlbearSpell,
  _policy?: CompendiumVisibilityPolicy,
): CompendiumSpell | null {
  const entryId = resolveEntryId('spell', s as StoredSpell);
  return {
    id: entryId,
    name: s.name,
    level: s.level,
    ...(s.damage ? { damage: s.damage } : {}),
    ...(s.type ? { type: s.type } : {}),
    ...(s.save ? { save: s.save } : {}),
    ...(s.aoe ? { aoe: s.aoe } : {}),
    ...(s.attack !== undefined ? { attack: s.attack } : {}),
    ...(s.secondary ? { secondary: s.secondary } : {}),
    ...(s.description ? { description: s.description } : {}),
    source: s.source,
    isCustom: true,
  };
}

async function monstersFromRawOverrides(
  source?: string,
  policy?: CompendiumVisibilityPolicy,
): Promise<CompendiumMonster[]> {
  const list = await readOverrideEntriesFromMongo(
    'monster',
    source?.trim() ? { source: source.trim() } : undefined,
  );
  const out: CompendiumMonster[] = [];
  for (const m of list) {
    const monster = compendiumMonsterFromOverride(m, policy);
    if (monster) out.push({ ...monster, isDraft: false });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function itemsFromRawOverrides(
  source?: string,
  policy?: CompendiumVisibilityPolicy,
): Promise<CompendiumItem[]> {
  const list = await readOverrideEntriesFromMongo(
    'item',
    source?.trim() ? { source: source.trim() } : undefined,
  );
  const out: CompendiumItem[] = [];
  for (const i of list) {
    const item = compendiumItemFromOverride(i, policy);
    if (item) out.push({ ...item, isDraft: false });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

async function spellsFromRawOverrides(
  source?: string,
  policy?: CompendiumVisibilityPolicy,
): Promise<CompendiumSpell[]> {
  const list = await readOverrideEntriesFromMongo(
    'spell',
    source?.trim() ? { source: source.trim() } : undefined,
  );
  const out: CompendiumSpell[] = [];
  for (const s of list) {
    const spell = compendiumSpellFromOverride(s, policy);
    if (spell) out.push({ ...spell, isDraft: false });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** Pre-build merged catalogs on server start so first search is instant. */
export async function warmCompendiumCatalog(): Promise<void> {
  try {
    const cache = await buildCatalogCache();
    console.log(
      `[Compendium] Catalog warmed: ${cache.monsters.length} monsters, ${cache.items.length} items, ${cache.spells.length} spells`,
    );
  } catch (err) {
    console.warn('[Compendium] Catalog warm failed:', err);
  }
}

registerCompendiumCacheInvalidator(invalidateCatalogCache);
registerCatalogRebuild(async () => {
  await rebuildCatalogCacheAtomic();
});

/** Human-readable label for a raw source string (PDF filename, etc.). */
export function formatSourceLabel(raw: string): string {
  let label = raw.trim();
  label = label.replace(/\.pdf$/i, '').replace(/\.PDF$/i, '');
  label = label.replace(/_/g, ' ');
  label = label.replace(/\s+/g, ' ').trim();
  return label || raw;
}

function splitSources(source: string | undefined): string[] {
  return splitCompendiumSources(source);
}

export interface CompendiumSaveOptions {
  previousName?: string;
  hidePrevious?: boolean;
  saveAs?: CompendiumSaveAs;
}

function resolveSaveAs(entry: { source?: string }, opts?: CompendiumSaveOptions): CompendiumSaveAs {
  if (opts?.saveAs) return opts.saveAs;
  const parts = splitSources(entry.source);
  if (parts.length > 0 && !parts.every((p) => p.toLowerCase() === 'custom')) {
    return 'replace';
  }
  return 'homebrew';
}

function prepareSavePayload<T extends { source?: string }>(entry: T, saveAs: CompendiumSaveAs): T {
  const src = entry.source?.trim();
  if (saveAs === 'homebrew') {
    if (src && src !== 'D&D Beyond') {
      return { ...entry, source: src };
    }
    return { ...entry, source: 'Custom' };
  }
  return { ...entry, source: src ? src : 'Custom' };
}

function sourceListFilter(
  id: string,
  c: { total: number; public: number },
  policy: CompendiumVisibilityPolicy,
  includeDrafts: boolean,
  excludeBundled: boolean,
  bundled: Set<string> | null,
): boolean {
  const normId = normalizeSourceLabel(id);

  // Books tab: counts come from override* arrays only — list every imported source book.
  if (excludeBundled) {
    return c.total > 0;
  }

  if (!includeDrafts && sourceIsLocked(id, policy)) return false;
  if (includeDrafts) return c.total > 0;
  return c.public > 0;
}

export async function listSources(
  kind: 'monsters' | 'items' | 'spells',
  opts?: { includeDrafts?: boolean; excludeBundled?: boolean },
): Promise<Array<{ id: string; label: string; count: number; locked?: boolean; draftCount?: number }>> {
  const includeDrafts = opts?.includeDrafts ?? false;
  const excludeBundled = opts?.excludeBundled ?? false;
  const bundled = excludeBundled ? bundledSourceLabelSet() : null;
  const policy = await readVisibilityPolicyFast();

  if (excludeBundled) {
    const counts = await resolveBookSourceCountsForKind(kind, policy);
    return mapSourceListResults(counts, policy, true, true, null);
  }

  const compendiumKind = kindToCompendiumKind(kind);
  const entries = await loadEntriesForSourceList(kind, false);
  const counts = tallySourceCounts(entries, compendiumKind, policy);
  return mapSourceListResults(counts, policy, includeDrafts, false, null);
}

const SYNC_STATUS_TTL_MS = 5_000;

export async function getSyncStatus(): Promise<CompendiumSyncStatus> {
  const rebuild = getCatalogRebuildProgress();
  if (!rebuild && syncStatusCache && Date.now() - syncStatusCache.at < SYNC_STATUS_TTL_MS) {
    return syncStatusCache.value;
  }

  const stamps: string[] = [];

  await pingCompendiumStorage();
  const storageHealth = getCompendiumStorageHealthSnapshot();

  const dbVersion = await readPostgresGlobalVersion();
  if (dbVersion) stamps.push(dbVersion);

  const extVersion = await fetchExtensionVersion();
  if (extVersion) stamps.push(extVersion);

  const file = loadGlobalFallback(true);
  if (file?.lastUpdated) stamps.push(new Date(file.lastUpdated).toISOString());

  const fileRev = globalFallbackFileRevision();
  if (fileRev) stamps.push(fileRev);

  const postgresConnected = storageHealth.state === 'connected' && Boolean(dbVersion);
  const hasLocal = isLocalCatalogAvailable() || Boolean(file);
  const hasExtension = Boolean(extVersion);

  let entryCounts = getCatalogEntryCounts() ?? undefined;
  if (postgresConnected && (!entryCounts || entryCounts.monsters + entryCounts.items + entryCounts.spells === 0)) {
    const postgresCounts = await readOverrideCountsFromMongo();
    const typedCounts = await readOverrideCountsFromTypedCollections();
    const pick = (a: { monsters: number; items: number; spells: number } | null, b: typeof a) => {
      if (!a) return b ?? undefined;
      if (!b) return a;
      const aTotal = a.monsters + a.items + a.spells;
      const bTotal = b.monsters + b.items + b.spells;
      return bTotal > aTotal ? b : a;
    };
    const best = pick(postgresCounts, typedCounts);
    if (best && best.monsters + best.items + best.spells > 0) {
      entryCounts = best;
    }
  }

  const value: CompendiumSyncStatus = {
    lastUpdated: stamps.length ? newestIso(...stamps) : new Date(0).toISOString(),
    storage: postgresConnected ? 'postgresql' : hasLocal || hasExtension ? 'local' : 'unavailable',
    mongoConnected: postgresConnected,
    mongoHealth: {
      state: storageHealth.state,
      configured: storageHealth.configured,
      circuitOpen: storageHealth.circuitOpen,
      ...(storageHealth.lastCheckedAt ? { lastCheckedAt: storageHealth.lastCheckedAt } : {}),
      ...(storageHealth.lastSuccessAt ? { lastSuccessAt: storageHealth.lastSuccessAt } : {}),
      ...(storageHealth.lastError ? { lastError: storageHealth.lastError } : {}),
      ...(storageHealth.latencyMs != null ? { latencyMs: storageHealth.latencyMs } : {}),
    },
    catalogRev: getCatalogRevision() ?? undefined,
    entryCounts,
    ...(rebuild ? { catalogRebuild: rebuild } : {}),
  };
  if (!rebuild) {
    syncStatusCache = { at: Date.now(), value };
  }
  return value;
}

export async function searchMonsters(opts: {
  q?: string;
  crMin?: number;
  crMax?: number;
  page?: number;
  limit?: number;
  isCustom?: boolean;
  source?: string;
  includeDrafts?: boolean;
}) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const policy = await getCatalogPolicy();
  const sourceFilter = opts.source?.trim();

  if (sourceFilter) {
    const fromCache = await filterCachedEntriesBySource(
      'monster',
      getCachedMonsters,
      sourceFilter,
      policy,
      opts.includeDrafts ?? false,
    );
    let filtered = filterMonsters(fromCache, opts.q ?? '', opts.crMin, opts.crMax);
    if (opts.isCustom === true) {
      filtered = filtered.filter((m) => isHomebrewEntry(m.isCustom, m.source));
    } else if (opts.isCustom === false) {
      filtered = filtered.filter((m) => !isHomebrewEntry(m.isCustom, m.source));
    }
    return paginate(filtered, page, limit);
  }

  await ensureCatalogIncludesOverrides();
  let merged = filterVisible('monster', await getCachedMonsters(), policy, opts.includeDrafts ?? false);
  let filtered = filterMonsters(merged, opts.q ?? '', opts.crMin, opts.crMax);
  if (opts.isCustom === true) {
    filtered = filtered.filter((m) => isHomebrewEntry(m.isCustom, m.source));
  } else if (opts.isCustom === false) {
    filtered = filtered.filter((m) => !isHomebrewEntry(m.isCustom, m.source));
  }
  return paginate(filtered, page, limit);
}

export async function getMonsterById(id: string, opts?: { includeDrafts?: boolean }): Promise<CompendiumMonster | null> {
  const policy = await getCatalogPolicy();
  let hit = (await getCachedMonsters()).find((m) => m.id === id);
  if (!hit) {
    const raw = await readOverrideEntryByIdFromMongo('monster', id);
    if (raw) hit = compendiumMonsterFromOverride(raw as OwlbearMonster, policy) ?? undefined;
  }
  if (!hit) {
    const base = await loadBaseMonsters();
    const raw = base.find((b) => b._id === id || slugify(b.name) === id);
    if (raw) {
      hit = toMonster(
        { ...raw, _id: raw._id ?? slugify(raw.name) } as StoredMonster,
        false,
        undefined,
        true,
      );
    }
  }
  if (!hit) {
    await ensureCatalogIncludesOverrides();
    hit = (await getCachedMonsters()).find((m) => m.id === id);
  }
  if (!hit) return null;
  const marked = markDraft('monster', hit, policy);
  if (marked.isDraft && !opts?.includeDrafts) return null;
  const imageUrl = await resolveCompendiumEntryImageUrl('monster', hit.name, hit.image);
  const out = imageUrl ? { ...marked, imageUrl } : marked;
  return out;
}

export async function findCatalogMonster(id: string): Promise<CompendiumMonster | null> {
  return (await getCachedMonsters()).find((m) => m.id === id) ?? null;
}

export async function searchItems(opts: {
  q?: string;
  page?: number;
  limit?: number;
  isCustom?: boolean;
  source?: string;
  includeDrafts?: boolean;
}) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const policy = await getCatalogPolicy();
  const sourceFilter = opts.source?.trim();
  const lower = (opts.q ?? '').trim().toLowerCase();

  if (sourceFilter) {
    const fromCache = await filterCachedEntriesBySource(
      'item',
      getCachedItems,
      sourceFilter,
      policy,
      opts.includeDrafts ?? false,
    );
    let filtered = fromCache.filter((i) => {
      if (!lower) return true;
      return i.name.toLowerCase().includes(lower) || i.description.toLowerCase().includes(lower);
    });
    if (opts.isCustom === true) {
      filtered = filtered.filter((i) => isHomebrewEntry(i.isCustom, i.source));
    } else if (opts.isCustom === false) {
      filtered = filtered.filter((i) => !isHomebrewEntry(i.isCustom, i.source));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(filtered, page, limit);
  }

  await ensureCatalogIncludesOverrides();
  const merged = filterVisible('item', await getCachedItems(), policy, opts.includeDrafts ?? false);
  let filtered = merged.filter((i) => {
    if (!lower) return true;
    return i.name.toLowerCase().includes(lower) || i.description.toLowerCase().includes(lower);
  });
  if (opts.isCustom === true) {
    filtered = filtered.filter((i) => isHomebrewEntry(i.isCustom, i.source));
  } else if (opts.isCustom === false) {
    filtered = filtered.filter((i) => !isHomebrewEntry(i.isCustom, i.source));
  }
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return paginate(filtered, page, limit);
}

export async function getItemById(id: string, opts?: { includeDrafts?: boolean }): Promise<CompendiumItem | null> {
  const policy = await getCatalogPolicy();
  let hit = (await getCachedItems()).find((i) => i.id === id);
  if (!hit) {
    const raw = await readOverrideEntryByIdFromMongo('item', id);
    if (raw) hit = compendiumItemFromOverride(raw as OwlbearItem, policy) ?? undefined;
  }
  if (!hit) {
    const base = await loadBaseItems();
    const raw = base.find((b) => b._id === id || slugify(b.name) === id);
    if (raw) {
      hit = {
        id: slugify(raw.name),
        name: raw.name,
        type: raw.type,
        source: raw.source,
        description: raw.description,
        isCustom: false,
        ...(raw.rarity ? { rarity: raw.rarity } : {}),
        ...(raw.flavor ? { flavor: raw.flavor } : {}),
        ...(raw.details ? { details: raw.details } : {}),
      };
    }
  }
  if (!hit) {
    await ensureCatalogIncludesOverrides();
    hit = (await getCachedItems()).find((i) => i.id === id);
  }
  if (!hit) return null;
  const marked = markDraft('item', hit, policy);
  if (marked.isDraft && !opts?.includeDrafts) return null;
  const imageUrl = await resolveCompendiumEntryImageUrl('item', hit.name, hit.image);
  return imageUrl ? { ...marked, imageUrl } : marked;
}

export async function findCatalogItem(id: string): Promise<CompendiumItem | null> {
  return (await getCachedItems()).find((i) => i.id === id) ?? null;
}

export async function searchSpells(opts: {
  q?: string;
  page?: number;
  limit?: number;
  isCustom?: boolean;
  source?: string;
  includeDrafts?: boolean;
}) {
  const page = opts.page ?? 1;
  const limit = Math.min(opts.limit ?? 50, 100);
  const policy = await getCatalogPolicy();
  const sourceFilter = opts.source?.trim();
  const lower = (opts.q ?? '').trim().toLowerCase();

  if (sourceFilter) {
    const fromCache = await filterCachedEntriesBySource(
      'spell',
      getCachedSpells,
      sourceFilter,
      policy,
      opts.includeDrafts ?? false,
    );
    let filtered = fromCache.filter((s) => {
      if (!lower) return true;
      return s.name.toLowerCase().includes(lower);
    });
    if (opts.isCustom === true) {
      filtered = filtered.filter((s) => isHomebrewEntry(s.isCustom, s.source));
    } else if (opts.isCustom === false) {
      filtered = filtered.filter((s) => !isHomebrewEntry(s.isCustom, s.source));
    }
    filtered.sort((a, b) => a.name.localeCompare(b.name));
    return paginate(filtered, page, limit);
  }

  await ensureCatalogIncludesOverrides();
  const merged = filterVisible('spell', await getCachedSpells(), policy, opts.includeDrafts ?? false);
  let filtered = merged.filter((s) => {
    if (!lower) return true;
    return s.name.toLowerCase().includes(lower);
  });
  if (opts.isCustom === true) {
    filtered = filtered.filter((s) => isHomebrewEntry(s.isCustom, s.source));
  } else if (opts.isCustom === false) {
    filtered = filtered.filter((s) => !isHomebrewEntry(s.isCustom, s.source));
  }
  filtered.sort((a, b) => a.name.localeCompare(b.name));
  return paginate(filtered, page, limit);
}

export async function getSpellById(id: string, opts?: { includeDrafts?: boolean }): Promise<CompendiumSpell | null> {
  const policy = await getCatalogPolicy();
  let hit = (await getCachedSpells()).find((s) => s.id === id);
  if (!hit) {
    const raw = await readOverrideEntryByIdFromMongo('spell', id);
    if (raw) hit = compendiumSpellFromOverride(raw as OwlbearSpell, policy) ?? undefined;
  }
  if (!hit) {
    const base = await loadBaseSpells();
    const raw = base.find((b) => b._id === id || slugify(b.name) === id);
    if (raw) {
      hit = {
        id: slugify(raw.name),
        name: raw.name,
        level: raw.level,
        ...(raw.damage ? { damage: raw.damage } : {}),
        ...(raw.type ? { type: raw.type } : {}),
        ...(raw.save ? { save: raw.save } : {}),
        ...(raw.aoe ? { aoe: raw.aoe } : {}),
        ...(raw.attack !== undefined ? { attack: raw.attack } : {}),
        ...(raw.secondary ? { secondary: raw.secondary } : {}),
        ...(raw.description ? { description: raw.description } : {}),
        source: raw.source,
        isCustom: false,
      };
    }
  }
  if (!hit) {
    await ensureCatalogIncludesOverrides();
    hit = (await getCachedSpells()).find((s) => s.id === id);
  }
  if (!hit) return null;
  const marked = markDraft('spell', hit, policy);
  if (marked.isDraft && !opts?.includeDrafts) return null;
  const imageUrl = await resolveCompendiumEntryImageUrl('spell', hit.name, undefined);
  return imageUrl ? { ...marked, imageUrl } : marked;
}

export { getCompendiumVisibilityPolicy };

export async function findCatalogSpell(id: string): Promise<CompendiumSpell | null> {
  return (await getCachedSpells()).find((s) => s.id === id) ?? null;
}

async function notifyTypedCollectionsChanged(): Promise<void> {
  const { markCompendiumWritePending } = await import('./compendiumMongoWatch');
  const { notifyCompendiumChanged } = await import('./compendiumChangeNotify');
  const { invalidateImportSkipIndex } = await import('./compendiumImportIndex');
  markCompendiumWritePending();
  invalidateImportSkipIndex();
  notifyCompendiumChanged(new Date());
}

async function upsertCollectionMonstersBulk(
  entries: Array<{ entry: OwlbearMonster; isCustom: boolean }>,
  opts?: { skipNotify?: boolean },
) {
  if (entries.length === 0) return;
  if (opts?.skipNotify) {
    const { markCompendiumWritePending } = await import('./compendiumMongoWatch');
    markCompendiumWritePending();
  }
  if (isCompendiumStorageUnavailable()) {
    throw new Error('PostgreSQL unavailable — monster bulk write skipped');
  }
  await upsertTypedImportEntriesBulk('monster', entries);
  if (!opts?.skipNotify) await notifyTypedCollectionsChanged();
}

async function upsertCollectionItemsBulk(
  entries: Array<{ entry: OwlbearItem; isCustom: boolean }>,
  opts?: { skipNotify?: boolean },
) {
  if (entries.length === 0) return;
  if (opts?.skipNotify) {
    const { markCompendiumWritePending } = await import('./compendiumMongoWatch');
    markCompendiumWritePending();
  }
  if (isCompendiumStorageUnavailable()) {
    throw new Error('PostgreSQL unavailable — item bulk write skipped');
  }
  await upsertTypedImportEntriesBulk('item', entries);
  if (!opts?.skipNotify) await notifyTypedCollectionsChanged();
}

async function upsertCollectionSpellsBulk(
  entries: Array<{ entry: OwlbearSpell; isCustom: boolean }>,
  opts?: { skipNotify?: boolean },
) {
  if (entries.length === 0) return;
  if (opts?.skipNotify) {
    const { markCompendiumWritePending } = await import('./compendiumMongoWatch');
    markCompendiumWritePending();
  }
  if (isCompendiumStorageUnavailable()) {
    throw new Error('PostgreSQL unavailable — spell bulk write skipped');
  }
  await upsertTypedImportEntriesBulk('spell', entries);
  if (!opts?.skipNotify) await notifyTypedCollectionsChanged();
}

const TYPED_SYNC_BATCH = 500;

/** Push unified override arrays into per-entry Mongo collections (keeps typed + global + local aligned). */
export async function syncTypedCollectionsFromOverrides(raw: OwlbearRawGlobalDoc): Promise<void> {
  const isBookImport = (source?: string) =>
    Boolean(source?.trim()) && source!.trim().toLowerCase() !== 'custom';

  const monsters = (raw.overrideMonsters ?? [])
    .filter((e: OwlbearMonster) => isBookImport(e.source))
    .map((entry: OwlbearMonster) => ({ entry, isCustom: false }));
  const items = (raw.overrideItems ?? [])
    .filter((e: OwlbearItem) => isBookImport(e.source))
    .map((entry: OwlbearItem) => ({ entry, isCustom: false }));
  const spells = (raw.overrideSpells ?? [])
    .filter((e: OwlbearSpell) => isBookImport(e.source))
    .map((entry: OwlbearSpell) => ({ entry, isCustom: false }));

  for (let i = 0; i < monsters.length; i += TYPED_SYNC_BATCH) {
    await upsertCollectionMonstersBulk(monsters.slice(i, i + TYPED_SYNC_BATCH));
  }
  for (let i = 0; i < items.length; i += TYPED_SYNC_BATCH) {
    await upsertCollectionItemsBulk(items.slice(i, i + TYPED_SYNC_BATCH));
  }
  for (let i = 0; i < spells.length; i += TYPED_SYNC_BATCH) {
    await upsertCollectionSpellsBulk(spells.slice(i, i + TYPED_SYNC_BATCH));
  }
}

async function upsertCollectionMonster(entry: OwlbearMonster, isCustom: boolean) {
  await upsertCollectionMonstersBulk([{ entry, isCustom }]);
}

async function upsertCollectionItem(entry: OwlbearItem, isCustom: boolean) {
  await upsertCollectionItemsBulk([{ entry, isCustom }]);
}

async function upsertCollectionSpell(entry: OwlbearSpell, isCustom: boolean) {
  await upsertCollectionSpellsBulk([{ entry, isCustom }]);
}

async function findMonsterAfterSave(name: string): Promise<CompendiumMonster | null> {
  const bySlug = await getMonsterById(slugify(name));
  if (bySlug) return bySlug;
  const merged = await getCachedMonsters();
  return merged.find((m) => namesMatch(m.name, name)) ?? null;
}

function monsterPayloadFromSave(
  payload: OwlbearMonster,
  saveAs: CompendiumSaveAs,
): CompendiumMonster {
  return {
    id: slugify(payload.name),
    name: payload.name,
    type: payload.type,
    source: payload.source,
    hp: payload.hp,
    ac: payload.ac,
    cr: String(payload.cr),
    description: payload.description,
    ...(payload.image ? { image: payload.image } : {}),
    ...(payload.stats ? { stats: payload.stats } : {}),
    isCustom: saveAs === 'homebrew',
  };
}

function itemPayloadFromSave(
  payload: OwlbearItem,
  saveAs: CompendiumSaveAs,
): CompendiumItem {
  return {
    id: slugify(payload.name),
    name: payload.name,
    type: payload.type,
    source: payload.source,
    description: payload.description,
    ...(payload.rarity ? { rarity: payload.rarity } : {}),
    ...(payload.flavor ? { flavor: payload.flavor } : {}),
    ...(payload.details ? { details: payload.details } : {}),
    ...(payload.image ? { image: payload.image } : {}),
    isCustom: saveAs === 'homebrew',
  };
}

function spellPayloadFromSave(
  payload: OwlbearSpell,
  saveAs: CompendiumSaveAs,
): CompendiumSpell {
  return {
    id: slugify(payload.name),
    name: payload.name,
    level: payload.level,
    ...(payload.damage ? { damage: payload.damage } : {}),
    ...(payload.type ? { type: payload.type } : {}),
    ...(payload.save ? { save: payload.save } : {}),
    ...(payload.aoe ? { aoe: payload.aoe } : {}),
    ...(payload.attack !== undefined ? { attack: payload.attack } : {}),
    ...(payload.secondary ? { secondary: payload.secondary } : {}),
    ...(payload.description ? { description: payload.description } : {}),
    source: payload.source,
    isCustom: saveAs === 'homebrew',
  };
}

export async function saveMonster(
  entry: OwlbearMonster,
  opts?: CompendiumSaveOptions,
): Promise<CompendiumMonster> {
  const saveAs = resolveSaveAs(entry, opts);
  const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);

  if (opts?.previousName && opts.previousName !== payload.name) {
    await deleteCompendiumEntryBySlug(slugify(opts.previousName));
  }

  await saveOwlbearEntry('monster', payload, {
    saveAs,
    previousName: opts?.previousName,
    hidePrevious: opts?.hidePrevious,
  });

  await upsertCollectionMonster(payload, saveAs === 'homebrew');

  const saved = await findMonsterAfterSave(payload.name);
  if (saved) return saved;

  console.warn('[Compendium] saveMonster: catalog lookup missed after write, returning payload', {
    name: payload.name,
    saveAs,
  });
  return monsterPayloadFromSave(payload, saveAs);
}

export async function saveItem(
  entry: OwlbearItem,
  opts?: CompendiumSaveOptions,
): Promise<CompendiumItem> {
  const saveAs = resolveSaveAs(entry, opts);
  const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);

  if (opts?.previousName && opts.previousName !== payload.name) {
    await deleteCompendiumEntryBySlug(slugify(opts.previousName));
  }

  await saveOwlbearEntry('item', payload, {
    saveAs,
    previousName: opts?.previousName,
    hidePrevious: opts?.hidePrevious,
  });

  await upsertCollectionItem(payload, saveAs === 'homebrew');

  const saved = await getItemById(slugify(payload.name));
  if (!saved) throw new Error('Failed to save item');
  return saved;
}

export async function saveSpell(
  entry: OwlbearSpell,
  opts?: CompendiumSaveOptions,
): Promise<CompendiumSpell> {
  const saveAs = resolveSaveAs(entry, opts);
  const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);

  if (opts?.previousName && opts.previousName !== payload.name) {
    await deleteCompendiumEntryBySlug(slugify(opts.previousName));
  }

  await saveOwlbearEntry('spell', payload, {
    saveAs,
    previousName: opts?.previousName,
    hidePrevious: opts?.hidePrevious,
  });

  await upsertCollectionSpell(payload, saveAs === 'homebrew');

  const saved = await getSpellById(slugify(payload.name));
  if (!saved) throw new Error('Failed to save spell');
  return saved;
}

export interface CompendiumBulkSaveResult<T> {
  entries: T[];
  persist: PersistRawGlobalDocResult;
}

export interface CompendiumBulkSaveOptions {
  /** Skip catalog rebuild per batch — call finishBulkCompendiumImport() once after bulk work. */
  deferCatalogRebuild?: boolean;
}

export async function finishBulkCompendiumImport(opts?: {
  /** Respond before catalog rebuild finishes — clients wait for compendium:updated. */
  deferCatalogRebuild?: boolean;
}): Promise<{ catalogRev: string | null; catalogRebuildPending?: boolean }> {
  const { reconcileCompendiumStorage } = await import('./compendiumFallbackMongoSync');
  await reconcileCompendiumStorage('bulk-import-finish');
  clearRawGlobalDocInflight();
  invalidateSyncStatusCache();
  const catalogRev = getCatalogRevision();
  const { notifyCompendiumCatalogRebuilt } = await import('./compendiumChangeNotify');
  const lastUpdated = new Date().toISOString();

  if (opts?.deferCatalogRebuild) {
    void notifyCompendiumCatalogRebuilt(lastUpdated).catch((err) => {
      console.warn(
        '[Compendium] Background catalog rebuild failed:',
        err instanceof Error ? err.message : err,
      );
    });
    return { catalogRev, catalogRebuildPending: true };
  }

  await notifyCompendiumCatalogRebuilt(lastUpdated);
  return { catalogRev: getCatalogRevision() };
}

/** Promote fallback JSON, warm catalog, and rebuild after Postgres/import drift. */
export async function reconcileCompendiumMongo(
  reason: string,
  opts?: { deferCatalogRebuild?: boolean; strict?: boolean },
): Promise<CompendiumSyncStatus> {
  await pingCompendiumStorage();

  const { reconcileCompendiumStorage } = await import('./compendiumFallbackMongoSync');
  const { ensureBundledSourcesLocked, ensureImportedSourcesUnlocked } = await import('./compendiumBundledLock');
  await reconcileCompendiumStorage(reason);
  await ensureBundledSourcesLocked(reason);
  await ensureImportedSourcesUnlocked(reason);
  clearRawGlobalDocInflight();
  invalidateSyncStatusCache();
  await warmCompendiumCatalog();
  await finishBulkCompendiumImport({ deferCatalogRebuild: opts?.deferCatalogRebuild ?? true });

  const status = await getSyncStatus();
  const postgresDown = status.mongoHealth?.configured && status.mongoHealth.state !== 'connected';
  if (postgresDown && opts?.strict !== false) {
    const detail =
      status.mongoHealth?.lastError
      ?? `PostgreSQL still ${status.mongoHealth?.state ?? 'unavailable'} after heal`;
    throw new Error(detail);
  }
  return status;
}

async function saveEntriesBulkForImport<T extends OwlbearMonster | OwlbearItem | OwlbearSpell, R>(
  kind: CompendiumKind,
  entries: Array<{ entry: T; opts?: CompendiumSaveOptions }>,
  upsertCollection: (prepared: Array<{ entry: T; isCustom: boolean }>, opts?: { skipNotify?: boolean }) => Promise<void>,
  toResult: (payload: T, saveAs: CompendiumSaveAs) => R,
): Promise<CompendiumBulkSaveResult<R>> {
  if (entries.length === 0) {
    const lastUpdated = new Date().toISOString();
    return {
      entries: [],
      persist: {
        doc: normalizeOwlbearGlobalDoc({
          _id: 'global',
          monsters: [],
          items: [],
          spells: [],
          overrideMonsters: [],
          overrideItems: [],
          overrideSpells: [],
          deleted: [],
          images: {},
          imagesData: {},
          entryImages: {},
          lockedSources: [],
          publishedEntryKeys: [],
          lastUpdated,
        }),
        lastUpdated,
        mongoPersisted: true,
      },
    };
  }

  const { patchOwlbearEntriesBulk } = await import('./compendiumOwlbearPersist');
  const prepared = entries.map(({ entry, opts }) => {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    return { payload, saveAs, opts };
  });

  let typedMongoOk = true;
  await upsertCollection(
    prepared.map(({ payload, saveAs }) => ({ entry: payload, isCustom: saveAs === 'homebrew' })),
    { skipNotify: true },
  ).catch((err) => {
    typedMongoOk = false;
    console.error('[Compendium] Typed collection bulk write failed:', err instanceof Error ? err.message : err);
  });

  const lastUpdated = new Date().toISOString();
  return {
    entries: prepared.map(({ payload, saveAs }) => toResult(payload, saveAs)),
    persist: {
      doc: normalizeOwlbearGlobalDoc({
        _id: 'global',
        monsters: [],
        items: [],
        spells: [],
        overrideMonsters: [],
        overrideItems: [],
        overrideSpells: [],
        deleted: [],
        images: {},
        imagesData: {},
        entryImages: {},
        lockedSources: [],
        publishedEntryKeys: [],
        lastUpdated,
      }),
      lastUpdated,
      mongoPersisted: typedMongoOk,
    },
  };
}

export async function saveMonstersBulkForImport(
  entries: Array<{ entry: OwlbearMonster; opts?: CompendiumSaveOptions }>,
): Promise<CompendiumBulkSaveResult<CompendiumMonster>> {
  return saveEntriesBulkForImport(
    'monster',
    entries,
    async (rows, opts) => {
      await upsertCollectionMonstersBulk(rows, opts);
    },
    (payload, saveAs) => monsterPayloadFromSave(payload, saveAs),
  );
}

export async function saveItemsBulkForImport(
  entries: Array<{ entry: OwlbearItem; opts?: CompendiumSaveOptions }>,
): Promise<CompendiumBulkSaveResult<CompendiumItem>> {
  return saveEntriesBulkForImport(
    'item',
    entries,
    async (rows, opts) => {
      await upsertCollectionItemsBulk(rows, opts);
    },
    (payload, saveAs) => itemPayloadFromSave(payload, saveAs),
  );
}

export async function saveSpellsBulkForImport(
  entries: Array<{ entry: OwlbearSpell; opts?: CompendiumSaveOptions }>,
): Promise<CompendiumBulkSaveResult<CompendiumSpell>> {
  return saveEntriesBulkForImport(
    'spell',
    entries,
    async (rows, opts) => {
      await upsertCollectionSpellsBulk(rows, opts);
    },
    (payload, saveAs) => spellPayloadFromSave(payload, saveAs),
  );
}

export async function saveMonstersBulk(
  entries: Array<{ entry: OwlbearMonster; opts?: CompendiumSaveOptions }>,
  bulkOpts?: CompendiumBulkSaveOptions,
): Promise<CompendiumBulkSaveResult<CompendiumMonster>> {
  if (entries.length === 0) {
    const raw = await readRawGlobalDoc({ includeImageData: false });
    return {
      entries: [],
      persist: {
        doc: normalizeOwlbearGlobalDoc(raw),
        lastUpdated: raw.lastUpdated
          ? new Date(raw.lastUpdated as string | Date).toISOString()
          : new Date(0).toISOString(),
        mongoPersisted: true,
      },
    };
  }

  const prepared = entries.map(({ entry, opts }) => {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    return { payload, saveAs, opts };
  });

  const persist = await saveOwlbearEntriesBulk(
    'monster',
    prepared.map(({ payload, saveAs, opts }) => ({
      entry: payload,
      opts: {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
      },
    })),
    { notify: bulkOpts?.deferCatalogRebuild ? 'none' : 'rebuild' },
  );

  await upsertCollectionMonstersBulk(
    prepared.map(({ payload, saveAs }) => ({ entry: payload, isCustom: saveAs === 'homebrew' })),
  );

  return {
    entries: prepared.map(({ payload, saveAs }) => monsterPayloadFromSave(payload, saveAs)),
    persist,
  };
}

export async function saveItemsBulk(
  entries: Array<{ entry: OwlbearItem; opts?: CompendiumSaveOptions }>,
  bulkOpts?: CompendiumBulkSaveOptions,
): Promise<CompendiumBulkSaveResult<CompendiumItem>> {
  if (entries.length === 0) {
    const raw = await readRawGlobalDoc({ includeImageData: false });
    return {
      entries: [],
      persist: {
        doc: normalizeOwlbearGlobalDoc(raw),
        lastUpdated: raw.lastUpdated
          ? new Date(raw.lastUpdated as string | Date).toISOString()
          : new Date(0).toISOString(),
        mongoPersisted: true,
      },
    };
  }

  const prepared = entries.map(({ entry, opts }) => {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    return { payload, saveAs, opts };
  });

  const persist = await saveOwlbearEntriesBulk(
    'item',
    prepared.map(({ payload, saveAs, opts }) => ({
      entry: payload,
      opts: {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
      },
    })),
    { notify: bulkOpts?.deferCatalogRebuild ? 'none' : 'rebuild' },
  );

  await upsertCollectionItemsBulk(
    prepared.map(({ payload, saveAs }) => ({ entry: payload, isCustom: saveAs === 'homebrew' })),
  );

  return {
    entries: prepared.map(({ payload, saveAs }) => itemPayloadFromSave(payload, saveAs)),
    persist,
  };
}

export async function saveSpellsBulk(
  entries: Array<{ entry: OwlbearSpell; opts?: CompendiumSaveOptions }>,
  bulkOpts?: CompendiumBulkSaveOptions,
): Promise<CompendiumBulkSaveResult<CompendiumSpell>> {
  if (entries.length === 0) {
    const raw = await readRawGlobalDoc({ includeImageData: false });
    return {
      entries: [],
      persist: {
        doc: normalizeOwlbearGlobalDoc(raw),
        lastUpdated: raw.lastUpdated
          ? new Date(raw.lastUpdated as string | Date).toISOString()
          : new Date(0).toISOString(),
        mongoPersisted: true,
      },
    };
  }

  const prepared = entries.map(({ entry, opts }) => {
    const saveAs = resolveSaveAs(entry, opts);
    const payload = prepareSavePayload({ ...entry, source: entry.source || 'Custom' }, saveAs);
    return { payload, saveAs, opts };
  });

  const persist = await saveOwlbearEntriesBulk(
    'spell',
    prepared.map(({ payload, saveAs, opts }) => ({
      entry: payload,
      opts: {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
      },
    })),
    { notify: bulkOpts?.deferCatalogRebuild ? 'none' : 'rebuild' },
  );

  await upsertCollectionSpellsBulk(
    prepared.map(({ payload, saveAs }) => ({ entry: payload, isCustom: saveAs === 'homebrew' })),
  );

  return {
    entries: prepared.map(({ payload, saveAs }) => spellPayloadFromSave(payload, saveAs)),
    persist,
  };
}

export async function deleteCompendiumEntry(
  name: string,
  kind: 'monster' | 'item' | 'spell',
): Promise<void> {
  const id = slugify(name);

  let inBaseCatalog = false;
  const stored = await readOverrideEntryByIdFromMongo(kind, id);
  inBaseCatalog = Boolean(stored && !('isCustom' in stored && stored.isCustom));

  let customOnly = false;

  {
    const global = await globalDoc();
    const inGlobalMonsters = (global.monsters ?? []).some((m) => m.name === name);
    const inGlobalItems = (global.items ?? []).some((i) => i.name === name);
    const inGlobalSpells = (global.spells ?? []).some((s) => s.name.toLowerCase() === name.toLowerCase());

    customOnly = kind === 'monster'
      ? inGlobalMonsters && !inBaseCatalog
      : kind === 'item'
        ? inGlobalItems && !inBaseCatalog
        : inGlobalSpells && !inBaseCatalog;
  }

  await deleteOwlbearEntry(kind, name, { inBaseCatalog });

  if (!customOnly) return;

  await deleteCompendiumEntryBySlug(id);
}

export { isLikelyValidItem, slugify };
