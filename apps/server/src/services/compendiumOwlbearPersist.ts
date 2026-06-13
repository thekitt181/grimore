import type {
  CompendiumGlobalDoc,
  CompendiumSaveAs,
  OwlbearItem,
  OwlbearMonster,
  OwlbearRawGlobalDoc,
  OwlbearSpell,
} from '@grimoire/shared';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import {
  applyPostgresGlobalImagePatch,
  isCompendiumStorageUnavailable,
  persistRawGlobalDocToPostgres,
  readBookSourceLabelsFromPostgres,
  readRawGlobalDocFromPostgres,
  touchCompendiumMeta,
} from './compendiumPostgres';
import {
  clearGlobalFallbackCache,
  loadGlobalFallback,
  loadRawGlobalFallback,
  saveGlobalFallback,
} from './compendiumGlobalFallback';
import { notifyCompendiumChanged, notifyCompendiumCatalogRebuilt } from './compendiumChangeNotify';
import { invalidateMongoImageRefsCache } from './compendiumGlobal';
import { invalidateCompendiumImageMemoryCache, setCachedImageBlob, setCachedImageRef, setCachedEntrySlice } from './compendiumImageMemoryCache';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import {
  invalidateExtensionGlobalCache,
  notifyExtensionDataChanged,
} from './compendiumExtensionBridge';
import { invalidateCompendiumCaches } from './compendiumCache';
import {
  loadLocalItems,
  loadLocalMonsters,
  loadLocalSpells,
} from './compendiumLocal';
import { compendiumImageKey, toOwlbearMongoImageRef } from '@grimoire/monster-dex';
import {
  entryNameKey,
  namesMatch,
  normalizeEntryName,
  normalizeOwlbearRawDoc,
} from './compendiumMerge';
import { readTypedImportOverrideSlices } from './compendiumMongoReads';
import { scheduleFallbackMongoSync } from './compendiumFallbackMongoSync';

export type CompendiumKind = 'monster' | 'item' | 'spell';

type OwlbearEntry = (OwlbearMonster | OwlbearItem | OwlbearSpell) & {
  originBookName?: string;
  image?: string;
};

const KIND_FIELDS = {
  monster: {
    custom: 'monsters' as const,
    override: 'overrideMonsters' as const,
  },
  item: {
    custom: 'items' as const,
    override: 'overrideItems' as const,
  },
  spell: {
    custom: 'spells' as const,
    override: 'overrideSpells' as const,
  },
};

const EMPTY_RAW: OwlbearRawGlobalDoc = {
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
  lastUpdated: new Date(0).toISOString(),
};

function normalizeEntryImageField(entry: OwlbearEntry): OwlbearEntry {
  if (!entry.image) return entry;
  return { ...entry, image: toOwlbearMongoImageRef(entry.image) };
}

function normalizeRawDocImages(raw: OwlbearRawGlobalDoc): void {
  if (raw.images) {
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.images)) {
      next[key] = toOwlbearMongoImageRef(value);
    }
    raw.images = next;
  }

  if (raw.entryImages) {
    for (const [name, urls] of Object.entries(raw.entryImages)) {
      raw.entryImages[name] = urls.map((url) => toOwlbearMongoImageRef(url));
    }
  }

  for (const field of [
    'monsters',
    'items',
    'spells',
    'overrideMonsters',
    'overrideItems',
    'overrideSpells',
  ] as const) {
    const list = raw[field];
    if (Array.isArray(list)) {
      (raw as Record<string, unknown>)[field] = list.map(normalizeEntryImageField);
    }
  }
}

function normalizeRawDoc(raw: OwlbearRawGlobalDoc): OwlbearRawGlobalDoc {
  const merged = normalizeOwlbearRawDoc({
    ...EMPTY_RAW,
    ...raw,
    _id: 'global',
    monsters: raw.monsters ?? [],
    items: raw.items ?? [],
    spells: raw.spells ?? [],
    overrideMonsters: raw.overrideMonsters ?? [],
    overrideItems: raw.overrideItems ?? [],
    overrideSpells: raw.overrideSpells ?? [],
    deleted: raw.deleted ?? [],
    images: raw.images ?? {},
    imagesData: raw.imagesData ?? {},
    entryImages: raw.entryImages ?? {},
    lockedSources: raw.lockedSources ?? [],
    publishedEntryKeys: raw.publishedEntryKeys ?? [],
  });
  normalizeRawDocImages(merged);
  return merged;
}

function rawPersistFingerprint(raw: OwlbearRawGlobalDoc): string {
  return JSON.stringify({
    monsters: raw.monsters,
    items: raw.items,
    spells: raw.spells,
    overrideMonsters: raw.overrideMonsters,
    overrideItems: raw.overrideItems,
    overrideSpells: raw.overrideSpells,
    deleted: raw.deleted,
    images: raw.images,
    imagesData: raw.imagesData,
    entryImages: raw.entryImages,
  });
}

function getList(raw: OwlbearRawGlobalDoc, field: keyof OwlbearRawGlobalDoc): OwlbearEntry[] {
  const val = raw[field];
  return Array.isArray(val) ? [...(val as OwlbearEntry[])] : [];
}

function setList(raw: OwlbearRawGlobalDoc, field: keyof OwlbearRawGlobalDoc, list: OwlbearEntry[]): void {
  (raw as Record<string, unknown>)[field] = list;
}

function findBuiltInByName(kind: CompendiumKind, name: string): OwlbearEntry | null {
  const target = normalizeEntryName(name);
  if (!target) return null;
  if (kind === 'monster') {
    return loadLocalMonsters().find((m) => namesMatch(m.name, target)) ?? null;
  }
  if (kind === 'item') {
    return loadLocalItems().find((i) => namesMatch(i.name, target)) ?? null;
  }
  return loadLocalSpells().find((s) => namesMatch(s.name, target)) ?? null;
}

function isBuiltInEntry(kind: CompendiumKind, name: string): boolean {
  return Boolean(findBuiltInByName(kind, name));
}

function applySourceBookOrigin<T extends OwlbearEntry>(
  entry: T,
  kind: CompendiumKind,
  originName: string | null,
): T {
  const lookupName = originName || entry.originBookName || entry.name;
  const builtIn = findBuiltInByName(kind, lookupName);
  if (!builtIn) return entry;

  const merged = { ...builtIn, ...entry, name: entry.name } as T;
  if (builtIn.source) merged.source = builtIn.source;
  else if (entry.source && entry.source !== 'Custom') merged.source = entry.source;

  const bookOrigin = originName || entry.originBookName;
  if (bookOrigin && !namesMatch(bookOrigin, entry.name) && isBuiltInEntry(kind, bookOrigin)) {
    merged.originBookName = normalizeEntryName(bookOrigin);
  } else if (entry.originBookName) {
    merged.originBookName = normalizeEntryName(entry.originBookName);
  }
  return merged;
}

function resolveOriginName(
  kind: CompendiumKind,
  entry: OwlbearEntry,
  previousName?: string,
): string | null {
  if (previousName && isBuiltInEntry(kind, previousName)) {
    return normalizeEntryName(previousName);
  }
  if (isBuiltInEntry(kind, entry.name)) {
    return normalizeEntryName(entry.name);
  }
  if (previousName) return normalizeEntryName(previousName);
  return null;
}

function upsertEntry(list: OwlbearEntry[], entry: OwlbearEntry): OwlbearEntry[] {
  const key = entryNameKey(entry.name);
  const idx = list.findIndex((e) => entryNameKey(e.name) === key);
  if (idx >= 0) {
    const next = [...list];
    next[idx] = entry;
    return next;
  }
  return [...list, entry];
}

function removeEntry(list: OwlbearEntry[], name: string): OwlbearEntry[] {
  return list.filter((e) => !namesMatch(e.name, name));
}

function filterCustomDuplicates(
  customs: OwlbearEntry[],
  entry: OwlbearEntry,
  originName: string | null,
): OwlbearEntry[] {
  return customs.filter(
    (e) =>
      !namesMatch(e.name, entry.name)
      && !(entry.originBookName && namesMatch(e.name, entry.originBookName))
      && !(originName && namesMatch(e.name, originName)),
  );
}

function addDeleted(raw: OwlbearRawGlobalDoc, name: string, kind: CompendiumKind): void {
  const builtIn = findBuiltInByName(kind, name);
  const canonical = builtIn?.name ?? normalizeEntryName(name);
  const deleted = [...(raw.deleted ?? [])];
  if (!deleted.some((d) => namesMatch(d, canonical))) {
    deleted.push(canonical);
    raw.deleted = deleted;
  }
}

function hideBuiltInOriginal(raw: OwlbearRawGlobalDoc, kind: CompendiumKind, originName: string | null): void {
  if (!originName || !isBuiltInEntry(kind, originName)) return;
  addDeleted(raw, originName, kind);
}

/** Dedupe overrides and strip stale custom copies in Postgres/local mirror. */
export async function reconcileRawGlobalStorage(): Promise<void> {
  if (isCompendiumStorageUnavailable()) return;
  try {
    const doc = await readRawGlobalDoc({ includeImageData: false });
    const cleaned = normalizeRawDoc(doc);
    if (rawPersistFingerprint(doc) === rawPersistFingerprint(cleaned)) return;
    await persistRawGlobalDoc(cleaned);
    console.log('[Compendium] Reconciled compendium data in PostgreSQL');
  } catch (err) {
    console.warn(
      '[Compendium] Postgres reconcile skipped:',
      err instanceof Error ? err.message : err,
    );
  }
}

export type PersistNotifyMode = 'full' | 'rebuild' | 'none';

export interface PersistRawGlobalDocResult {
  doc: CompendiumGlobalDoc;
  lastUpdated: string;
  mongoPersisted: boolean;
}

/** Read the raw Owlbear Mongo/fallback doc (override* arrays intact). */
export type RawGlobalDocReadOptions = {
  /** When false, skip multi-MB image blobs (catalog/list only). Default true for writes. */
  includeImageData?: boolean;
  /** When true, skip image ref/history queries (catalog rebuild only). */
  skipImageMaps?: boolean;
};

const RAW_GLOBAL_LITE_PROJECTION = { imagesData: 0 as const, images: 0 as const, entryImages: 0 as const };
const RAW_GLOBAL_LITE_READ_MS = 60_000;
const RAW_GLOBAL_FULL_READ_MS = 45_000;

let rawGlobalInflight: { key: string; promise: Promise<OwlbearRawGlobalDoc> } | null = null;

export function clearRawGlobalDocInflight(): void {
  rawGlobalInflight = null;
}

const OVERRIDE_SLICES_PROJECTION = {
  overrideMonsters: 1,
  overrideItems: 1,
  overrideSpells: 1,
} as const;

function overrideSliceCount(slices: {
  overrideMonsters?: unknown[];
  overrideItems?: unknown[];
  overrideSpells?: unknown[];
}): number {
  return (slices.overrideMonsters?.length ?? 0)
    + (slices.overrideItems?.length ?? 0)
    + (slices.overrideSpells?.length ?? 0);
}

export type BookSourceLabelBuckets = {
  monsterSources: Array<string | undefined>;
  itemSources: Array<string | undefined>;
  spellSources: Array<string | undefined>;
};

function bookSourceLabelCount(buckets: BookSourceLabelBuckets): number {
  return buckets.monsterSources.length + buckets.itemSources.length + buckets.spellSources.length;
}

/** Read only source fields — avoids loading multi-MB stat blocks. */
export async function readBookSourceLabelsFromMongo(): Promise<BookSourceLabelBuckets | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    const doc = await readBookSourceLabelsFromPostgres();
    if (!doc || bookSourceLabelCount(doc) === 0) return null;
    return doc;
  } catch (err) {
    console.warn(
      '[Compendium] Book source label read failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Fast Postgres read of DDB import override arrays for Compendium → Books. */
export async function readOverrideSlicesForBookList(): Promise<{
  overrideMonsters: OwlbearMonster[];
  overrideItems: OwlbearItem[];
  overrideSpells: OwlbearSpell[];
}> {
  if (!isCompendiumStorageUnavailable()) {
    try {
      const raw = await readRawGlobalDocFromPostgres({ includeImageData: false });
      if (raw) {
        const typed = await readTypedImportOverrideSlices();
        const mergeList = <T extends { name: string }>(global: T[] | undefined, typedList: T[]): T[] => {
          const map = new Map<string, T>();
          for (const entry of global ?? []) {
            if (entry?.name) map.set(entryNameKey(entry.name), entry);
          }
          for (const entry of typedList) {
            if (entry?.name) map.set(entryNameKey(entry.name), entry);
          }
          return Array.from(map.values());
        };
        const slices = {
          overrideMonsters: mergeList(raw.overrideMonsters, typed.overrideMonsters),
          overrideItems: mergeList(raw.overrideItems, typed.overrideItems),
          overrideSpells: mergeList(raw.overrideSpells, typed.overrideSpells),
        };
        if (overrideSliceCount(slices) > 0) return slices;
      }
    } catch (err) {
      console.warn(
        '[Compendium] Override slices read failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  clearRawGlobalDocInflight();
  const raw = await readRawGlobalDoc({ includeImageData: false });
  const typed = await readTypedImportOverrideSlices();
  const mergeList = <T extends { name: string }>(global: T[] | undefined, typedList: T[]): T[] => {
    const map = new Map<string, T>();
    for (const entry of global ?? []) {
      if (entry?.name) map.set(entryNameKey(entry.name), entry);
    }
    for (const entry of typedList) {
      if (entry?.name) map.set(entryNameKey(entry.name), entry);
    }
    return Array.from(map.values());
  };
  const slices = {
    overrideMonsters: mergeList(raw.overrideMonsters, typed.overrideMonsters),
    overrideItems: mergeList(raw.overrideItems, typed.overrideItems),
    overrideSpells: mergeList(raw.overrideSpells, typed.overrideSpells),
  };
  if (overrideSliceCount(slices) > 0) return slices;

  const fallbackRaw = loadRawGlobalFallback();
  if (fallbackRaw) {
    const normalized = normalizeRawDoc(fallbackRaw);
    const fromFile = {
      overrideMonsters: normalized.overrideMonsters ?? [],
      overrideItems: normalized.overrideItems ?? [],
      overrideSpells: normalized.overrideSpells ?? [],
    };
    if (overrideSliceCount(fromFile) > 0) return fromFile;
  }

  return slices;
}

async function readRawGlobalDocInner(opts: RawGlobalDocReadOptions = {}): Promise<OwlbearRawGlobalDoc> {
  const includeImageData = opts.includeImageData !== false;
  const skipImageMaps = opts.skipImageMaps === true;

  if (!isCompendiumStorageUnavailable()) {
    try {
      const postgresDoc = await readRawGlobalDocFromPostgres({ includeImageData, skipImageMaps });
      if (postgresDoc) {
        const fallbackRaw = loadRawGlobalFallback();
        if (fallbackRaw) {
          const normalizedFallback = normalizeRawDoc(fallbackRaw);
          const { mergeRawGlobalDocs, rawOverrideEntryCount } = await import('./compendiumFallbackMongoSync');
          if (rawOverrideEntryCount(normalizedFallback) > rawOverrideEntryCount(postgresDoc)) {
            console.warn(
              '[Compendium] Local fallback has more imported entries than Postgres — merging for read',
            );
            return mergeRawGlobalDocs(postgresDoc, normalizedFallback);
          }
        }
        return postgresDoc;
      }
    } catch (err) {
      console.warn(
        '[Compendium] Raw Postgres read failed, trying fallback:',
        err instanceof Error ? err.message : err,
      );
    }
  }

  const fallbackRaw = loadRawGlobalFallback();
  if (fallbackRaw) return normalizeRawDoc(fallbackRaw);

  const normalized = loadGlobalFallback(true);
  if (normalized) {
    return normalizeRawDoc({
      ...normalized,
      monsters: [],
      items: [],
      spells: [],
      overrideMonsters: normalized.monsters,
      overrideItems: normalized.items,
      overrideSpells: normalized.spells,
    });
  }

  return { ...EMPTY_RAW };
}

export async function readRawGlobalDoc(opts: RawGlobalDocReadOptions = {}): Promise<OwlbearRawGlobalDoc> {
  const key = `${opts.includeImageData === false ? 'lite' : 'full'}:${opts.skipImageMaps ? 'noimg' : 'img'}`;
  if (rawGlobalInflight?.key === key) return rawGlobalInflight.promise;

  const promise = readRawGlobalDocInner(opts).finally(() => {
    if (rawGlobalInflight?.promise === promise) rawGlobalInflight = null;
  });
  rawGlobalInflight = { key, promise };
  return promise;
}

export async function persistRawGlobalDoc(
  raw: OwlbearRawGlobalDoc,
  opts?: { notify?: PersistNotifyMode },
): Promise<PersistRawGlobalDocResult> {
  const lastUpdated = new Date().toISOString();
  const payload = normalizeRawDoc({ ...raw, lastUpdated });
  const notify = opts?.notify ?? 'full';

  markCompendiumWritePending();
  const postgresPersisted = await persistRawGlobalDocToPostgres(payload, new Date(lastUpdated));

  const normalized = normalizeOwlbearGlobalDoc(payload);
  const fallbackPersisted = Boolean(saveGlobalFallback(normalized, payload));

  if (!postgresPersisted && !fallbackPersisted && isCompendiumStorageUnavailable()) {
    throw new Error('PostgreSQL unavailable and failed to write local compendium mirror');
  }

  if (notify === 'rebuild') {
    await notifyCompendiumCatalogRebuilt(lastUpdated);
  } else if (notify === 'full') {
    notifyCompendiumChanged(lastUpdated);
  }

  if (process.env['COMPENDIUM_MONGO_ONLY'] !== '1') {
    void notifyExtensionDataChanged(lastUpdated);
  }
  return {
    doc: normalized,
    lastUpdated,
    mongoPersisted: postgresPersisted || fallbackPersisted,
  };
}

/** Clear read caches before a write without wiping the warm catalog. */
function clearRawGlobalReadCaches(): void {
  invalidateExtensionGlobalCache();
  clearGlobalFallbackCache();
  clearRawGlobalDocInflight();
  invalidateMongoImageRefsCache();
}

function invalidateWriteCaches(): void {
  clearRawGlobalReadCaches();
  invalidateCompendiumCaches();
}

export interface OwlbearSaveOptions {
  saveAs: CompendiumSaveAs;
  previousName?: string;
  hidePrevious?: boolean;
}

/** Save a compendium entry in Owlbear-native Mongo format (override* vs custom arrays). */
function applyOwlbearEntryToRaw(
  raw: OwlbearRawGlobalDoc,
  kind: CompendiumKind,
  entry: OwlbearMonster | OwlbearItem | OwlbearSpell,
  opts: OwlbearSaveOptions,
): void {
  const fields = KIND_FIELDS[kind];
  const prepared = { ...entry } as OwlbearEntry;
  const imageKey = compendiumImageKey(kind, prepared.name);
  if (raw.images?.[imageKey]) {
    prepared.image = toOwlbearMongoImageRef(raw.images[imageKey]!);
  } else if (prepared.image) {
    prepared.image = toOwlbearMongoImageRef(prepared.image);
  }

  if (opts.saveAs === 'replace') {
    const originName = resolveOriginName(kind, prepared, opts.previousName);
    const overrideEntry = applySourceBookOrigin(prepared, kind, originName);

    if (opts.previousName && !namesMatch(opts.previousName, overrideEntry.name)) {
      hideBuiltInOriginal(raw, kind, opts.previousName);
      setList(raw, fields.override, removeEntry(getList(raw, fields.override), opts.previousName));
      setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), opts.previousName));
      if (opts.hidePrevious) addDeleted(raw, opts.previousName, kind);
    }

    setList(
      raw,
      fields.override,
      upsertEntry(getList(raw, fields.override), overrideEntry),
    );
    setList(
      raw,
      fields.custom,
      filterCustomDuplicates(getList(raw, fields.custom), overrideEntry, originName),
    );
    hideBuiltInOriginal(raw, kind, originName);
    if (overrideEntry.originBookName) {
      hideBuiltInOriginal(raw, kind, overrideEntry.originBookName);
    }
  } else {
    const customEntry = { ...prepared, source: 'Custom' } as OwlbearEntry;
    if (opts.previousName && !namesMatch(opts.previousName, customEntry.name)) {
      setList(raw, fields.override, removeEntry(getList(raw, fields.override), opts.previousName));
      setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), opts.previousName));
    }
    setList(raw, fields.override, removeEntry(getList(raw, fields.override), customEntry.name));
    setList(
      raw,
      fields.custom,
      upsertEntry(getList(raw, fields.custom), customEntry),
    );
  }
}

async function mergeRawWithLocalFallbackIfRicher(
  raw: OwlbearRawGlobalDoc,
): Promise<OwlbearRawGlobalDoc> {
  const fallbackRaw = loadRawGlobalFallback();
  if (!fallbackRaw) return raw;
  const normalizedFallback = normalizeRawDoc(fallbackRaw);
  const { mergeRawGlobalDocs, rawOverrideEntryCount } = await import('./compendiumFallbackMongoSync');
  if (rawOverrideEntryCount(normalizedFallback) <= rawOverrideEntryCount(raw)) return raw;
  return mergeRawGlobalDocs(raw, normalizedFallback);
}

async function persistEntriesToRawDoc(
  kind: CompendiumKind,
  entries: Array<{ entry: OwlbearMonster | OwlbearItem | OwlbearSpell; opts: OwlbearSaveOptions }>,
  notify: PersistNotifyMode,
): Promise<PersistRawGlobalDocResult> {
  clearRawGlobalReadCaches();
  clearRawGlobalDocInflight();
  let raw = await readRawGlobalDoc({ includeImageData: false });
  raw = await mergeRawWithLocalFallbackIfRicher(raw);
  for (const { entry, opts: entryOpts } of entries) {
    applyOwlbearEntryToRaw(raw, kind, entry, entryOpts);
  }
  return persistRawGlobalDoc(raw, { notify });
}

export async function saveOwlbearEntriesBulk(
  kind: CompendiumKind,
  entries: Array<{ entry: OwlbearMonster | OwlbearItem | OwlbearSpell; opts: OwlbearSaveOptions }>,
  opts?: { notify?: PersistNotifyMode },
): Promise<PersistRawGlobalDocResult> {
  if (entries.length === 0) {
    const raw = await readRawGlobalDoc({ includeImageData: false });
    return {
      doc: normalizeOwlbearGlobalDoc(raw),
      lastUpdated: raw.lastUpdated
        ? new Date(raw.lastUpdated as string | Date).toISOString()
        : new Date(0).toISOString(),
      mongoPersisted: true,
    };
  }
  const notify = opts?.notify ?? 'rebuild';
  return enqueueCompendiumWrite(async () => persistEntriesToRawDoc(kind, entries, notify));
}

/** Fast Mongo patches for bulk import; falls back to full doc persist when Mongo is down. */
export async function patchOwlbearEntriesBulk(
  kind: CompendiumKind,
  entries: Array<{ entry: OwlbearMonster | OwlbearItem | OwlbearSpell; opts: OwlbearSaveOptions }>,
  opts?: { typedCollectionsOnly?: boolean },
): Promise<{ mongoPersisted: boolean; lastUpdated: string }> {
  if (entries.length === 0) {
    return { mongoPersisted: true, lastUpdated: new Date().toISOString() };
  }

  return enqueueCompendiumWrite(async () => {
    const lastUpdated = new Date().toISOString();

    if (isCompendiumStorageUnavailable()) {
      console.warn('[Compendium] Postgres unavailable — saving import via compendium doc fallback');
      const result = await persistEntriesToRawDoc(kind, entries, 'none');
      return { mongoPersisted: result.mongoPersisted, lastUpdated: result.lastUpdated };
    }

    if (opts?.typedCollectionsOnly) {
      markCompendiumWritePending();
      try {
        await touchCompendiumMeta(new Date(lastUpdated));
        clearRawGlobalDocInflight();
        return { mongoPersisted: true, lastUpdated };
      } catch (err) {
        console.warn(
          '[Compendium] typed-only import metadata update failed:',
          err instanceof Error ? err.message : err,
        );
        return { mongoPersisted: false, lastUpdated };
      }
    }

    try {
      const result = await persistEntriesToRawDoc(kind, entries, 'none');
      clearRawGlobalDocInflight();
      const { invalidateImportSkipIndex } = await import('./compendiumImportIndex');
      invalidateImportSkipIndex();
      scheduleFallbackMongoSync('bulk-patch');
      return { mongoPersisted: result.mongoPersisted, lastUpdated: result.lastUpdated };
    } catch (err) {
      console.warn(
        '[Compendium] patchOwlbearEntriesBulk failed:',
        err instanceof Error ? err.message : err,
      );
      const result = await persistEntriesToRawDoc(kind, entries, 'none');
      return { mongoPersisted: result.mongoPersisted, lastUpdated: result.lastUpdated };
    }
  });
}

export async function saveOwlbearEntry(
  kind: CompendiumKind,
  entry: OwlbearMonster | OwlbearItem | OwlbearSpell,
  opts: OwlbearSaveOptions,
): Promise<CompendiumGlobalDoc> {
  const result = await saveOwlbearEntriesBulk(kind, [{ entry, opts }]);
  return result.doc;
}

export interface OwlbearDeleteOptions {
  inBaseCatalog: boolean;
}

/** Delete/hide a compendium entry using Owlbear-native storage. */
export async function deleteOwlbearEntry(
  kind: CompendiumKind,
  name: string,
  opts: OwlbearDeleteOptions,
): Promise<CompendiumGlobalDoc> {
  return enqueueCompendiumWrite(async () => {
    clearRawGlobalReadCaches();
    const raw = await readRawGlobalDoc({ includeImageData: false });
    const fields = KIND_FIELDS[kind];

    const inCustom = getList(raw, fields.custom).some((e) => namesMatch(e.name, name));
    const inOverride = getList(raw, fields.override).some((e) => namesMatch(e.name, name));
    const customOnly = inCustom && !opts.inBaseCatalog && !inOverride;

    if (customOnly) {
      setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), name));
    } else {
      addDeleted(raw, name, kind);
      setList(raw, fields.override, removeEntry(getList(raw, fields.override), name));
      setList(raw, fields.custom, removeEntry(getList(raw, fields.custom), name));
    }

    return persistRawGlobalDoc(raw, { notify: 'rebuild' }).then((r) => r.doc);
  });
}

/** Patch image fields on the raw doc without flattening override/custom structure. */
export type OwlbearImageFieldsPatch = Partial<Pick<CompendiumGlobalDoc, 'images' | 'imagesData' | 'entryImages'>> & {
  /** Keys to remove from `images` after merge. */
  removeImageKeys?: string[];
  /** Keys to remove from `imagesData` after merge. */
  removeImageDataKeys?: string[];
};

/** Fast partial Postgres update for image fields (avoids rewriting the full global doc). */
export async function applyMongoGlobalImagePatch(
  patch: OwlbearImageFieldsPatch,
  entryPatch?: { kind: CompendiumKind; name: string; image?: string },
): Promise<CompendiumGlobalDoc> {
  return enqueueCompendiumWrite(async () => {
    invalidateWriteCaches();
    if (isCompendiumStorageUnavailable()) {
      throw new Error('PostgreSQL unavailable');
    }

    const lastUpdated = new Date().toISOString();
    markCompendiumWritePending();
    await applyPostgresGlobalImagePatch({
      ...(patch.images ? { images: patch.images } : {}),
      ...(patch.imagesData ? { imagesData: patch.imagesData } : {}),
      ...(patch.entryImages ? { entryImages: patch.entryImages } : {}),
      ...(patch.removeImageKeys?.length ? { unsetImageKeys: patch.removeImageKeys } : {}),
      ...(patch.removeImageDataKeys?.length ? { unsetImageDataKeys: patch.removeImageDataKeys } : {}),
    });

    notifyCompendiumChanged(lastUpdated);
    invalidateCompendiumCaches();
    for (const key of Object.keys(patch.images ?? {})) {
      invalidateCompendiumImageMemoryCache({ imageKey: key });
    }
    for (const name of Object.keys(patch.entryImages ?? {})) {
      const keys = Object.keys(patch.images ?? {});
      for (const key of keys) {
        invalidateCompendiumImageMemoryCache({ imageKey: key, entryName: name });
      }
    }
    for (const key of patch.removeImageKeys ?? []) {
      invalidateCompendiumImageMemoryCache({ imageKey: key });
    }
    invalidateMongoImageRefsCache();

    if (patch.imagesData) {
      for (const [k, v] of Object.entries(patch.imagesData)) {
        setCachedImageBlob(k, v);
      }
    }
    if (patch.images) {
      for (const [k, v] of Object.entries(patch.images)) {
        setCachedImageRef(k, v);
      }
    }
    if (patch.entryImages) {
      for (const [name, history] of Object.entries(patch.entryImages)) {
        for (const [imageKey, imageRef] of Object.entries(patch.images ?? {})) {
          setCachedEntrySlice(imageKey, name, {
            imageRef,
            entryHistory: history,
            lastUpdated,
          });
        }
      }
    }

    if (entryPatch?.image) {
      const raw = await readRawGlobalDoc({ includeImageData: false });
      const fields = KIND_FIELDS[entryPatch.kind];
      const applyImage = (list: OwlbearEntry[]): OwlbearEntry[] => {
        const idx = list.findIndex((e) => namesMatch(e.name, entryPatch.name));
        if (idx < 0) return list;
        const next = [...list];
        const entry = { ...next[idx]! } as OwlbearEntry & { image?: string };
        entry.image = toOwlbearMongoImageRef(entryPatch.image!);
        next[idx] = entry;
        return next;
      };
      setList(raw, fields.override, applyImage(getList(raw, fields.override)));
      setList(raw, fields.custom, applyImage(getList(raw, fields.custom)));
      await persistRawGlobalDoc(raw, { notify: 'none' });
    }

    return normalizeOwlbearGlobalDoc({
      _id: 'global',
      monsters: [],
      items: [],
      spells: [],
      deleted: [],
      images: patch.images ?? {},
      imagesData: patch.imagesData ?? {},
      entryImages: patch.entryImages ?? {},
      lastUpdated,
    });
  });
}

export async function saveOwlbearImageFields(
  patch: OwlbearImageFieldsPatch,
  entryPatch?: { kind: CompendiumKind; name: string; image?: string },
): Promise<CompendiumGlobalDoc> {
  return enqueueCompendiumWrite(async () => {
    invalidateWriteCaches();
    const raw = await readRawGlobalDoc();

    raw.images = { ...(raw.images ?? {}), ...(patch.images ?? {}) };
    raw.imagesData = { ...(raw.imagesData ?? {}), ...(patch.imagesData ?? {}) };
    raw.entryImages = { ...(raw.entryImages ?? {}), ...(patch.entryImages ?? {}) };

    for (const key of patch.removeImageKeys ?? []) {
      delete raw.images?.[key];
    }
    for (const key of patch.removeImageDataKeys ?? []) {
      delete raw.imagesData?.[key];
    }

    if (entryPatch) {
      const fields = KIND_FIELDS[entryPatch.kind];
      const applyImage = (list: OwlbearEntry[]): OwlbearEntry[] => {
        const idx = list.findIndex((e) => namesMatch(e.name, entryPatch.name));
        if (idx < 0) return list;
        const next = [...list];
        const entry = { ...next[idx]! } as OwlbearEntry & { image?: string };
        if (entryPatch.image) entry.image = toOwlbearMongoImageRef(entryPatch.image);
        else delete entry.image;
        next[idx] = entry;
        return next;
      };

      setList(raw, fields.override, applyImage(getList(raw, fields.override)));
      setList(raw, fields.custom, applyImage(getList(raw, fields.custom)));
    }

    return persistRawGlobalDoc(raw, { notify: 'rebuild' }).then((r) => r.doc);
  });
}
