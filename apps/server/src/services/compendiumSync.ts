import type {
  CompendiumGlobalDoc,
  CompendiumItem,
  CompendiumMonster,
  CompendiumSpell,
  CompendiumSyncStatus,
  CompendiumSaveAs,
  OwlbearItem,
  OwlbearMonster,
  OwlbearSpell,
} from '@grimoire/shared';
import { isHomebrewEntry, normalizeOwlbearGlobalDoc, splitCompendiumSources } from '@grimoire/shared';
import { isLikelyValidItem, parseCr, slugify } from '@grimoire/monster-dex';
import { getCollection, isMongoCircuitOpen, withMongoTimeout, resetMongoClient } from '../lib/mongo';
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
  type BookSourceLabelBuckets,
  clearRawGlobalDocInflight,
  type CompendiumKind,
  type PersistRawGlobalDocResult,
} from './compendiumOwlbearPersist';
import {
  dedupeByEntryName,
  entryNameKey,
  filterCustomEntries,
  isHiddenBuiltIn,
  namesMatch,
  normalizeOwlbearRawDoc,
} from './compendiumMerge';
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
  readBookSourceLabelBucketsWithFallback,
  readOverrideCountsFromMongo,
  readOverrideEntriesFromMongo,
  readOverrideEntryByIdFromMongo,
} from './compendiumMongoReads';
import { getCompendiumVisibilityPolicy } from './compendiumSourcePolicy';
import {
  bundledSourceLabelSet,
  ensureBundledSourcesLocked,
  ensureImportedSourcesUnlocked,
} from './compendiumBundledLock';
import {
  readVisibilityPolicyFast,
  registerCatalogPolicySink,
} from './compendiumPolicyCache';

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
  const activeOverrides = dedupeByEntryName(overrides);
  const activeCustoms = filterCustomEntries('monster', customs, activeOverrides, deleted);
  const out = new Map<string, CompendiumMonster>();

  for (const b of base) {
    if (isHiddenBuiltIn(b.name, activeOverrides, deleted)) continue;
    const ov = activeOverrides.find((o) => namesMatch(o.name, b.name));
    const merged = ov ? { ...b, ...ov } : b;
    out.set(entryNameKey(b.name), toMonster(
      { ...merged, _id: b._id },
      isHomebrewEntry(Boolean(ov), merged.source),
      global,
      lite,
    ));
  }

  for (const ov of activeOverrides) {
    const key = entryNameKey(ov.name);
    if (out.has(key)) continue;
    out.set(key, toMonster(
      { ...ov, _id: slugify(ov.name) } as StoredMonster,
      isHomebrewEntry(true, ov.source),
      global,
      lite,
    ));
  }

  for (const c of activeCustoms) {
    if (deleted.some((d) => namesMatch(d, c.name))) continue;
    const key = entryNameKey(c.name);
    if (out.has(key)) continue;
    out.set(key, toMonster(
      { ...c, _id: slugify(c.name) } as StoredMonster,
      true,
      global,
      lite,
    ));
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
  const activeOverrides = dedupeByEntryName(overrides);
  const activeCustoms = filterCustomEntries('item', customs, activeOverrides, deleted);
  const out = new Map<string, CompendiumItem>();

  for (const b of base) {
    if (isHiddenBuiltIn(b.name, activeOverrides, deleted)) continue;
    const ov = activeOverrides.find((o) => namesMatch(o.name, b.name));
    const merged = ov ? { ...b, ...ov } : b;
    const item: CompendiumItem = {
      id: b._id,
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
    out.set(entryNameKey(b.name), item);
  }

  for (const ov of activeOverrides) {
    const key = entryNameKey(ov.name);
    if (out.has(key)) continue;
    const item: CompendiumItem = {
      id: slugify(ov.name),
      ...ov,
      isCustom: isHomebrewEntry(true, ov.source),
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'item', ov.name, ov.image);
      if (imageUrl) item.imageUrl = imageUrl;
    }
    out.set(key, item);
  }

  for (const c of activeCustoms) {
    if (deleted.some((d) => namesMatch(d, c.name))) continue;
    const key = entryNameKey(c.name);
    if (out.has(key)) continue;
    const item: CompendiumItem = {
      id: slugify(c.name),
      ...c,
      isCustom: true,
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'item', c.name, c.image);
      if (imageUrl) item.imageUrl = imageUrl;
    }
    out.set(key, item);
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
  const activeOverrides = dedupeByEntryName(overrides);
  const activeCustoms = filterCustomEntries('spell', customs, activeOverrides, deleted);
  const out = new Map<string, CompendiumSpell>();

  for (const b of base) {
    if (isHiddenBuiltIn(b.name, activeOverrides, deleted)) continue;
    const ov = activeOverrides.find((o) => namesMatch(o.name, b.name));
    const merged = ov ? { ...b, ...ov } : b;
    const spell: CompendiumSpell = {
      id: b._id,
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
    out.set(entryNameKey(b.name), spell);
  }

  for (const ov of activeOverrides) {
    const key = entryNameKey(ov.name);
    if (out.has(key)) continue;
    const spell: CompendiumSpell = {
      id: slugify(ov.name),
      ...ov,
      isCustom: isHomebrewEntry(true, ov.source),
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'spell', ov.name, undefined);
      if (imageUrl) spell.imageUrl = imageUrl;
    }
    out.set(key, spell);
  }

  for (const c of activeCustoms) {
    if (deleted.some((d) => namesMatch(d, c.name))) continue;
    const key = entryNameKey(c.name);
    if (out.has(key)) continue;
    const spell: CompendiumSpell = {
      id: slugify(c.name),
      ...c,
      isCustom: true,
    };
    if (global && !lite) {
      const imageUrl = resolveEntryImageUrl(global, 'spell', c.name, undefined);
      if (imageUrl) spell.imageUrl = imageUrl;
    }
    out.set(key, spell);
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

/** Prefer fast local JSON catalog; Mongo collection is homebrew-only fallback. */
async function loadBaseMonsters(): Promise<StoredMonster[]> {
  const local = loadLocalMonsters();
  if (local.length > 0) return local;
  try {
    const col = await getCollection<StoredMonster>('monsters');
    if (!col) return [];
    return await withMongoTimeout(col.find({}).limit(10_000).toArray());
  } catch {
    resetMongoClient();
    return loadLocalMonsters();
  }
}

async function loadBaseItems(): Promise<StoredItem[]> {
  const local = loadLocalItems();
  if (local.length > 0) return local;
  try {
    const col = await getCollection<StoredItem>('items');
    if (!col) return [];
    return await withMongoTimeout(col.find({}).limit(10_000).toArray());
  } catch {
    resetMongoClient();
    return loadLocalItems();
  }
}

async function loadBaseSpells(): Promise<StoredSpell[]> {
  const local = loadLocalSpells();
  if (local.length > 0) return local;
  try {
    const col = await getCollection<StoredSpell>('spells');
    if (!col) return [];
    return await withMongoTimeout(col.find({}).limit(10_000).toArray());
  } catch {
    resetMongoClient();
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

function catalogEntryCount(cache: CatalogCache): number {
  return cache.monsters.length + cache.items.length + cache.spells.length;
}

function invalidateCatalogCache(): void {
  catalogCache = null;
  catalogBuildPromise = null;
}

function invalidateSyncStatusCache(): void {
  syncStatusCache = null;
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

async function buildCatalogCacheFromRaw(
  raw: Awaited<ReturnType<typeof readRawGlobalDoc>>,
  revSuffix?: string,
): Promise<CatalogCache> {
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
  const [monsters, items, spells] = await Promise.all([
    mergeMonsters(await loadBaseMonsters(), raw.overrideMonsters ?? [], raw.monsters ?? [], deleted, global, true),
    mergeItems(await loadBaseItems(), raw.overrideItems ?? [], raw.items ?? [], deleted, global, true),
    mergeSpells(await loadBaseSpells(), raw.overrideSpells ?? [], raw.spells ?? [], deleted, global, true),
  ]);
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
    const raw = await readRawGlobalDoc({ includeImageData: false });
    let built = await buildCatalogCacheFromRaw(raw);

    const rawFallback = loadRawGlobalFallback();
    if (rawFallback) {
      const normalizedFallback = normalizeOwlbearRawDoc(rawFallback);
      if (rawOverrideCount(normalizedFallback) > rawOverrideCount(raw)) {
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
        const fallbackBuilt = await buildCatalogCacheFromRaw(normalizedFallback, 'raw-fallback');
        if (catalogEntryCount(fallbackBuilt) > 0) {
          console.warn('[Compendium] Primary rebuild empty — using local fallback file');
          built = fallbackBuilt;
        }
      }
    }

    if (catalogEntryCount(built) === 0 && rawOverrideCount(raw) > 0) {
      console.warn('[Compendium] Rebuild empty despite Mongo overrides — retrying raw build');
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

/** Rebuild catalog after a write while keeping the previous cache if rebuild fails. */
export async function rebuildCatalogCacheAtomic(): Promise<CatalogCache> {
  const previousCache = catalogCache;
  catalogBuildPromise = null;
  const built = await executeCatalogBuild(previousCache);
  catalogCache = built;
  invalidateSyncStatusCache();
  return built;
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
  if (!(await catalogIsMissingOverrides())) return;
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
      return catalogCache;
    } finally {
      catalogBuildPromise = null;
    }
  })();

  return catalogBuildPromise;
}

async function getCachedMonsters(): Promise<CompendiumMonster[]> {
  return (await buildCatalogCache()).monsters;
}

async function getCachedItems(): Promise<CompendiumItem[]> {
  return (await buildCatalogCache()).items;
}

async function getCachedSpells(): Promise<CompendiumSpell[]> {
  return (await buildCatalogCache()).spells;
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
      count: includeDrafts ? c.total : c.public,
      ...(includeDrafts && sourceIsLocked(id, policy) ? { locked: true } : {}),
      ...(includeDrafts && c.draft > 0 ? { draftCount: c.draft } : {}),
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
  const bundled = bundledSourceLabelSet();
  for (const entry of entries) {
    if (isHomebrewEntry(true, entry.source)) continue;
    for (const part of splitSources(entry.source)) {
      if (part.toLowerCase() === 'custom') continue;
      const norm = normalizeSourceLabel(part);
      if (bundled.has(norm)) continue;
      if (policyIsSourceLocked(part, policy)) continue;
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

function tallyBooksFromSourceLabels(
  buckets: BookSourceLabelBuckets | null,
  _policy: CompendiumVisibilityPolicy,
): SourceCountMap {
  if (!buckets) return new Map();
  const bundled = bundledSourceLabelSet();
  const counts: SourceCountMap = new Map();

  const addSources = (sources: Array<string | undefined>) => {
    for (const source of sources) {
      if (!source?.trim()) continue;
      for (const part of splitSources(source)) {
        if (part.toLowerCase() === 'custom') continue;
        const norm = normalizeSourceLabel(part);
        if (bundled.has(norm)) continue;
        const cur = counts.get(part) ?? { total: 0, public: 0, draft: 0 };
        cur.total += 1;
        cur.public += 1;
        counts.set(part, cur);
      }
    }
  };

  addSources(buckets.monsterSources);
  addSources(buckets.itemSources);
  addSources(buckets.spellSources);
  return counts;
}

function bookSourcesFromLabelBuckets(
  buckets: BookSourceLabelBuckets | null,
  policy: CompendiumVisibilityPolicy,
): Array<{ id: string; label: string; count: number }> {
  const bundled = bundledSourceLabelSet();
  const counts = tallyBooksFromSourceLabels(buckets, policy);
  return mapSourceListResults(counts, policy, false, true, bundled).map(
    ({ id, label, count }) => ({ id, label, count }),
  );
}

/** Merged DDB-imported book list (monsters + items + spells) for Compendium → Books. */
export async function listAllBookSources(): Promise<
  Array<{ id: string; label: string; count: number }>
> {
  const mongoCounts = await readOverrideCountsFromMongo();
  const overrideTotal = mongoCounts
    ? mongoCounts.monsters + mongoCounts.items + mongoCounts.spells
    : 0;

  await ensureImportedSourcesUnlocked('listBooks');
  let policy = await readVisibilityPolicyFast();
  let labelBuckets = await readBookSourceLabelBucketsWithFallback();
  let results = bookSourcesFromLabelBuckets(labelBuckets, policy);

  if (results.length === 0 && overrideTotal > 0) {
    await ensureImportedSourcesUnlocked('listBooks-recovery');
    policy = await readVisibilityPolicyFast();
    labelBuckets = await readBookSourceLabelBucketsWithFallback();
    results = bookSourcesFromLabelBuckets(labelBuckets, policy);
  }

  if (results.length === 0 && overrideTotal === 0) {
    const { promoteFallbackToMongo } = await import('./compendiumFallbackMongoSync');
    await promoteFallbackToMongo('listBooks');
    clearRawGlobalDocInflight();
    labelBuckets = await readBookSourceLabelBucketsWithFallback();
    policy = await readVisibilityPolicyFast();
    results = bookSourcesFromLabelBuckets(labelBuckets, policy);
    if (results.length === 0 && labelBuckets) {
      await ensureImportedSourcesUnlocked('listBooks-recovery');
      policy = await readVisibilityPolicyFast();
      results = bookSourcesFromLabelBuckets(labelBuckets, policy);
    }
  }

  if (results.length > 0) {
    console.log(`[Compendium] Books list: ${results.length} imported source(s)`);
  } else if (overrideTotal > 0) {
    console.warn(
      `[Compendium] Books list empty but Mongo has ${overrideTotal} override entries — check bundled/lock filters`,
    );
  } else {
    console.warn('[Compendium] Books list empty — no imported override sources in Mongo');
  }

  return results;
}

function compendiumMonsterFromOverride(
  m: OwlbearMonster,
  policy?: CompendiumVisibilityPolicy,
): CompendiumMonster | null {
  if (isHomebrewEntry(true, m.source)) return null;
  const bundled = bundledSourceLabelSet();
  const parts = splitSources(m.source);
  if (parts.some((p) => bundled.has(normalizeSourceLabel(p)))) return null;
  if (policy && parts.some((p) => policyIsSourceLocked(p, policy))) return null;
  return toMonster(
    { ...m, _id: slugify(m.name) } as StoredMonster,
    true,
    undefined,
    true,
  );
}

function compendiumItemFromOverride(
  i: OwlbearItem,
  policy?: CompendiumVisibilityPolicy,
): CompendiumItem | null {
  if (isHomebrewEntry(true, i.source)) return null;
  const bundled = bundledSourceLabelSet();
  const parts = splitSources(i.source);
  if (parts.some((p) => bundled.has(normalizeSourceLabel(p)))) return null;
  if (policy && parts.some((p) => policyIsSourceLocked(p, policy))) return null;
  return {
    id: slugify(i.name),
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
  policy?: CompendiumVisibilityPolicy,
): CompendiumSpell | null {
  if (isHomebrewEntry(true, s.source)) return null;
  const bundled = bundledSourceLabelSet();
  const parts = splitSources(s.source);
  if (parts.some((p) => bundled.has(normalizeSourceLabel(p)))) return null;
  if (policy && parts.some((p) => policyIsSourceLocked(p, policy))) return null;
  return {
    id: slugify(s.name),
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
  if (saveAs === 'homebrew') {
    return { ...entry, source: 'Custom' };
  }
  return { ...entry, source: entry.source?.trim() ? entry.source : 'Custom' };
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

  // Books tab: hide bundled PDFs only — imported DDB books stay listed (unlock runs on list).
  if (excludeBundled) {
    if (bundled?.has(normId)) return false;
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
  await ensureBundledSourcesLocked('listSources');

  const includeDrafts = opts?.includeDrafts ?? false;
  const excludeBundled = opts?.excludeBundled ?? false;
  const bundled = excludeBundled ? bundledSourceLabelSet() : null;
  const policy = await readVisibilityPolicyFast();

  if (excludeBundled) {
    await ensureImportedSourcesUnlocked('listSources-books');
    clearRawGlobalDocInflight();
    const raw = await readRawGlobalDoc({ includeImageData: false });
    const overrides =
      kind === 'monsters'
        ? raw.overrideMonsters
        : kind === 'items'
          ? raw.overrideItems
          : raw.overrideSpells;
    const counts = tallyBooksSourceCountsForKind(
      overrides ?? [],
      kindToCompendiumKind(kind),
      policy,
    );
    return mapSourceListResults(counts, policy, false, true, bundled);
  }

  const compendiumKind = kindToCompendiumKind(kind);
  const entries = await loadEntriesForSourceList(kind, false);
  const counts = tallySourceCounts(entries, compendiumKind, policy);
  return mapSourceListResults(counts, policy, includeDrafts, false, null);
}

const SYNC_STATUS_TTL_MS = 5_000;

export async function getSyncStatus(): Promise<CompendiumSyncStatus> {
  if (syncStatusCache && Date.now() - syncStatusCache.at < SYNC_STATUS_TTL_MS) {
    return syncStatusCache.value;
  }

  const stamps: string[] = [];

  const mongoVersion = await readMongoGlobalVersion();
  if (mongoVersion) stamps.push(mongoVersion);

  const extVersion = await fetchExtensionVersion();
  if (extVersion) stamps.push(extVersion);

  const file = loadGlobalFallback(true);
  if (file?.lastUpdated) stamps.push(new Date(file.lastUpdated).toISOString());

  const fileRev = globalFallbackFileRevision();
  if (fileRev) stamps.push(fileRev);

  const col = await getCollection<CompendiumGlobalDoc>('data');
  const mongoConnected = Boolean(col && mongoVersion && !isMongoCircuitOpen());
  const hasLocal = isLocalCatalogAvailable() || Boolean(file);
  const hasExtension = Boolean(extVersion);

  let entryCounts = getCatalogEntryCounts() ?? undefined;
  if (mongoConnected && (!entryCounts || entryCounts.monsters + entryCounts.items + entryCounts.spells === 0)) {
    const mongoCounts = await readOverrideCountsFromMongo();
    if (mongoCounts && mongoCounts.monsters + mongoCounts.items + mongoCounts.spells > 0) {
      entryCounts = mongoCounts;
    }
  }

  const value: CompendiumSyncStatus = {
    lastUpdated: stamps.length ? newestIso(...stamps) : new Date(0).toISOString(),
    storage: mongoConnected ? 'mongodb' : hasLocal || hasExtension ? 'local' : 'unavailable',
    mongoConnected,
    catalogRev: getCatalogRevision() ?? undefined,
    entryCounts,
  };
  syncStatusCache = { at: Date.now(), value };
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
    let fromMongo = await monstersFromRawOverrides(sourceFilter, policy);
    fromMongo = filterVisible('monster', fromMongo, policy, opts.includeDrafts ?? false);
    let filtered = filterMonsters(fromMongo, opts.q ?? '', opts.crMin, opts.crMax);
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
    if (raw) hit = compendiumMonsterFromOverride(raw, policy) ?? undefined;
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
    let fromMongo = await itemsFromRawOverrides(sourceFilter, policy);
    fromMongo = filterVisible('item', fromMongo, policy, opts.includeDrafts ?? false);
    let filtered = fromMongo.filter((i) => {
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
    if (raw) hit = compendiumItemFromOverride(raw, policy) ?? undefined;
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
    let fromMongo = await spellsFromRawOverrides(sourceFilter, policy);
    fromMongo = filterVisible('spell', fromMongo, policy, opts.includeDrafts ?? false);
    let filtered = fromMongo.filter((s) => {
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
    if (raw) hit = compendiumSpellFromOverride(raw, policy) ?? undefined;
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

async function upsertCollectionMonstersBulk(entries: Array<{ entry: OwlbearMonster; isCustom: boolean }>) {
  const col = await getCollection<StoredMonster>('monsters');
  if (!col || entries.length === 0) return;
  await col.bulkWrite(
    entries.map(({ entry, isCustom }) => {
      const _id = slugify(entry.name);
      return {
        updateOne: {
          filter: { _id },
          update: { $set: { ...entry, _id, isCustom } },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
}

async function upsertCollectionItemsBulk(entries: Array<{ entry: OwlbearItem; isCustom: boolean }>) {
  const col = await getCollection<StoredItem>('items');
  if (!col || entries.length === 0) return;
  await col.bulkWrite(
    entries.map(({ entry, isCustom }) => {
      const _id = slugify(entry.name);
      return {
        updateOne: {
          filter: { _id },
          update: { $set: { ...entry, _id, isCustom } },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
}

async function upsertCollectionSpellsBulk(entries: Array<{ entry: OwlbearSpell; isCustom: boolean }>) {
  const col = await getCollection<StoredSpell>('spells');
  if (!col || entries.length === 0) return;
  await col.bulkWrite(
    entries.map(({ entry, isCustom }) => {
      const _id = slugify(entry.name);
      return {
        updateOne: {
          filter: { _id },
          update: { $set: { ...entry, _id, isCustom } },
          upsert: true,
        },
      };
    }),
    { ordered: false },
  );
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
    const col = await getCollection<StoredMonster>('monsters');
    if (col) await col.deleteOne({ _id: slugify(opts.previousName) });
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
    const col = await getCollection<StoredItem>('items');
    if (col) await col.deleteOne({ _id: slugify(opts.previousName) });
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
    const col = await getCollection<StoredSpell>('spells');
    if (col) await col.deleteOne({ _id: slugify(opts.previousName) });
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

export async function finishBulkCompendiumImport(): Promise<{ catalogRev: string | null }> {
  clearRawGlobalDocInflight();
  const { notifyCompendiumCatalogRebuilt } = await import('./compendiumChangeNotify');
  await notifyCompendiumCatalogRebuilt(new Date().toISOString());
  invalidateSyncStatusCache();
  return { catalogRev: getCatalogRevision() };
}

async function saveEntriesBulkForImport<T extends OwlbearMonster | OwlbearItem | OwlbearSpell, R>(
  kind: CompendiumKind,
  entries: Array<{ entry: T; opts?: CompendiumSaveOptions }>,
  upsertCollection: (prepared: Array<{ entry: T; isCustom: boolean }>) => Promise<void>,
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

  const patch = await patchOwlbearEntriesBulk(
    kind,
    prepared.map(({ payload, saveAs, opts }) => ({
      entry: payload,
      opts: {
        saveAs,
        previousName: opts?.previousName,
        hidePrevious: opts?.hidePrevious,
      },
    })),
  );

  await upsertCollection(
    prepared.map(({ payload, saveAs }) => ({ entry: payload, isCustom: saveAs === 'homebrew' })),
  );

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
        lastUpdated: patch.lastUpdated,
      }),
      lastUpdated: patch.lastUpdated,
      mongoPersisted: patch.mongoPersisted,
    },
  };
}

export async function saveMonstersBulkForImport(
  entries: Array<{ entry: OwlbearMonster; opts?: CompendiumSaveOptions }>,
): Promise<CompendiumBulkSaveResult<CompendiumMonster>> {
  return saveEntriesBulkForImport(
    'monster',
    entries,
    async (rows) => {
      await upsertCollectionMonstersBulk(rows);
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
    async (rows) => {
      await upsertCollectionItemsBulk(rows);
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
    async (rows) => {
      await upsertCollectionSpellsBulk(rows);
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
  if (kind === 'monster') {
    const col = await getCollection<StoredMonster>('monsters');
    const base = col ? await col.findOne({ _id: id }) : null;
    inBaseCatalog = Boolean(base && !base.isCustom);
  } else if (kind === 'item') {
    const col = await getCollection<StoredItem>('items');
    const base = col ? await col.findOne({ _id: id }) : null;
    inBaseCatalog = Boolean(base && !base.isCustom);
  } else {
    const col = await getCollection<StoredSpell>('spells');
    const base = col ? await col.findOne({ _id: id }) : null;
    inBaseCatalog = Boolean(base && !base.isCustom);
  }

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

  if (kind === 'monster') {
    const col = await getCollection<StoredMonster>('monsters');
    if (col) await col.deleteOne({ _id: id });
  } else if (kind === 'item') {
    const col = await getCollection<StoredItem>('items');
    if (col) await col.deleteOne({ _id: id });
  } else {
    const col = await getCollection<StoredSpell>('spells');
    if (col) await col.deleteOne({ _id: id });
  }
}

export { isLikelyValidItem, slugify };
