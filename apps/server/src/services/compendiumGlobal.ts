import type { CompendiumGlobalDoc, OwlbearRawGlobalDoc } from '@grimoire/shared';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import { resetMongoClient, shouldResetMongoClient } from '../lib/mongo';
import {
  isCompendiumStorageUnavailable,
  readPostgresEntryImageHistory,
  readPostgresEntryImageSlice,
  readPostgresGlobalImageRefs,
  readPostgresGlobalVersion,
  readPostgresImageDataKey,
  readPostgresImageRefKey,
  readRawGlobalDocFromPostgres,
  persistRawGlobalDocToPostgres,
} from './compendiumPostgres';
import {
  clearGlobalFallbackCache,
  globalFallbackFileRevision,
  loadGlobalFallback,
  saveGlobalFallback,
} from './compendiumGlobalFallback';
import { fetchExtensionGlobalDoc, invalidateExtensionGlobalCache } from './compendiumExtensionBridge';
import { notifyCompendiumChanged } from './compendiumChangeNotify';
import { markCompendiumWritePending } from './compendiumMongoWatch';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import {
  getCachedGlobalLite,
  setCachedGlobalLite,
  invalidateCompendiumCaches,
} from './compendiumCache';
import {
  getCachedEntrySlice,
  setCachedEntrySlice,
  getEntrySliceInflight,
  setEntrySliceInflight,
  getCachedImageRef,
  setCachedImageRef,
  getImageRefInflight,
  setImageRefInflight,
  getCachedImageBlob,
  setCachedImageBlob,
  getImageBlobInflight,
  setImageBlobInflight,
  invalidateCompendiumImageMemoryCache,
} from './compendiumImageMemoryCache';

const EMPTY_GLOBAL: CompendiumGlobalDoc = {
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

function mergeByKey<T>(secondary: T[], primary: T[], keyFn: (entry: T) => string): T[] {
  const map = new Map<string, T>();
  for (const entry of secondary) map.set(keyFn(entry), entry);
  for (const entry of primary) map.set(keyFn(entry), entry);
  return Array.from(map.values());
}

function mergeGlobalDocsWithPriority(
  secondary: CompendiumGlobalDoc,
  primary: CompendiumGlobalDoc,
): CompendiumGlobalDoc {
  return {
    _id: 'global',
    monsters: mergeByKey(secondary.monsters ?? [], primary.monsters ?? [], (m) => m.name.trim().toLowerCase()),
    items: mergeByKey(secondary.items ?? [], primary.items ?? [], (i) => i.name.trim().toLowerCase()),
    spells: mergeByKey(secondary.spells ?? [], primary.spells ?? [], (s) => s.name.toLowerCase()),
    deleted: [...new Set([...(secondary.deleted ?? []), ...(primary.deleted ?? [])])],
    images: { ...(secondary.images ?? {}), ...(primary.images ?? {}) },
    imagesData: { ...(secondary.imagesData ?? {}), ...(primary.imagesData ?? {}) },
    entryImages: { ...(secondary.entryImages ?? {}), ...(primary.entryImages ?? {}) },
    lastUpdated: newestIso(primary.lastUpdated, secondary.lastUpdated),
  };
}

/** Merge two global docs; the doc with the newer lastUpdated wins on conflicts. */
export function mergeGlobalDocs(a: CompendiumGlobalDoc, b: CompendiumGlobalDoc): CompendiumGlobalDoc {
  const aMs = new Date(a.lastUpdated).getTime();
  const bMs = new Date(b.lastUpdated).getTime();
  if (aMs >= bMs) return mergeGlobalDocsWithPriority(b, a);
  return mergeGlobalDocsWithPriority(a, b);
}

export function newestIso(...values: Array<string | Date | undefined>): string {
  let best = 0;
  for (const v of values) {
    if (v === undefined) continue;
    const ms = v instanceof Date ? v.getTime() : new Date(v).getTime();
    if (!Number.isNaN(ms) && ms > best) best = ms;
  }
  return new Date(best).toISOString();
}

export function isoTimestamp(value: string | Date | undefined): string {
  if (!value) return new Date(0).toISOString();
  return value instanceof Date ? value.toISOString() : value;
}

function withFileMtime(doc: CompendiumGlobalDoc): CompendiumGlobalDoc {
  const fileRev = globalFallbackFileRevision();
  if (!fileRev) return doc;
  const fileMs = new Date(fileRev).getTime();
  const docMs = new Date(doc.lastUpdated).getTime();
  if (fileMs > docMs) {
    return { ...doc, lastUpdated: fileRev };
  }
  return doc;
}

export type GlobalDocReadOptions = {
  /** Skip heavy base64 blobs — fine for search/list; keep false when saving or serving images. */
  includeImageData?: boolean;
};

const MONGO_LITE_READ_MS = 60_000;
const MONGO_FULL_READ_MS = 45_000;
const MONGO_VERSION_READ_MS = 10_000;
const MONGO_IMAGE_FIELD_READ_MS = 15_000;
const MONGO_IMAGE_DATA_READ_MS = 60_000;
const MONGO_IMAGE_REFS_READ_MS = 45_000;
const MONGO_WARN_COOLDOWN_MS = 30_000;

let lastMongoReadWarnAt = 0;

function warnMongoRead(message: string): void {
  const now = Date.now();
  if (now - lastMongoReadWarnAt < MONGO_WARN_COOLDOWN_MS) return;
  lastMongoReadWarnAt = now;
  console.warn(message);
}

let imageRefsCache: {
  rev: string;
  at: number;
  data: { images: Record<string, string>; entryImages: Record<string, string[]>; lastUpdated: string };
} | null = null;
let imageRefsInflight: Promise<{
  images: Record<string, string>;
  entryImages: Record<string, string[]>;
  lastUpdated: string;
} | null> | null = null;

export function invalidateMongoImageRefsCache(): void {
  imageRefsCache = null;
  imageRefsInflight = null;
}

/** Image maps without base64 blobs — enough to resolve static-image URLs. */

/** Read only one entry's image fields (fast — avoids downloading the whole images map). */
export async function readMongoEntryImageSlice(
  imageKey: string,
  entryName: string,
): Promise<{
  imageRef: string | null;
  entryHistory: string[];
  lastUpdated: string | null;
} | null> {
  if (!imageKey || !entryName) return null;

  const cached = getCachedEntrySlice(imageKey, entryName);
  if (cached) return cached;

  const inflight = getEntrySliceInflight(imageKey, entryName);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      if (isCompendiumStorageUnavailable()) return null;
      const slice = await readPostgresEntryImageSlice(imageKey, entryName);
      if (!slice) return null;
      setCachedEntrySlice(imageKey, entryName, slice);
      if (slice.imageRef) setCachedImageRef(imageKey, slice.imageRef);
      return slice;
    } catch (err) {
      warnMongoRead(
        `[Compendium] Postgres entry image read failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  })();

  setEntrySliceInflight(imageKey, entryName, promise);
  return promise;
}

/** Read a single images-map ref (for picking another entry's thumbnail). */
export async function readMongoImageRefKey(imageKey: string): Promise<string | null> {
  if (!imageKey) return null;

  const cached = getCachedImageRef(imageKey);
  if (cached !== undefined) return cached;

  const inflight = getImageRefInflight(imageKey);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      if (isCompendiumStorageUnavailable()) return null;
      const value = await readPostgresImageRefKey(imageKey);
      setCachedImageRef(imageKey, value);
      return value;
    } catch {
      return null;
    }
  })();

  setImageRefInflight(imageKey, promise);
  return promise;
}

export async function readMongoGlobalImageRefs(): Promise<{
  images: Record<string, string>;
  entryImages: Record<string, string[]>;
  lastUpdated: string;
} | null> {
  const version = await readMongoGlobalVersion();
  if (
    version
    && imageRefsCache?.rev === version
    && Date.now() - imageRefsCache.at < 120_000
  ) {
    return imageRefsCache.data;
  }
  if (imageRefsInflight) return imageRefsInflight;

  imageRefsInflight = (async () => {
    try {
      if (isCompendiumStorageUnavailable()) return null;
      const data = await readPostgresGlobalImageRefs();
      if (!data) return null;
      if (version) {
        imageRefsCache = { rev: version, at: Date.now(), data };
      }
      return data;
    } catch (err) {
      warnMongoRead(
        `[Compendium] Postgres image refs read failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    } finally {
      imageRefsInflight = null;
    }
  })();

  return imageRefsInflight;
}

/** Read a single stored blob without loading the full global doc. */
export async function readMongoImageDataKey(key: string): Promise<string | null> {
  const cached = getCachedImageBlob(key);
  if (cached) return cached;

  const inflight = getImageBlobInflight(key);
  if (inflight) return inflight;

  const promise = (async () => {
    try {
      if (isCompendiumStorageUnavailable()) return null;
      const value = await readPostgresImageDataKey(key);
      if (typeof value === 'string') {
        setCachedImageBlob(key, value);
        return value;
      }
      return null;
    } catch {
      return null;
    }
  })();

  setImageBlobInflight(key, promise);
  return promise;
}

/** Read entryImages history for one compendium entry name. */
export async function readMongoEntryImageHistory(entryName: string): Promise<string[]> {
  if (!entryName) return [];
  try {
    if (isCompendiumStorageUnavailable()) return [];
    return await readPostgresEntryImageHistory(entryName);
  } catch {
    return [];
  }
}

/** Lightweight version probe — avoids loading the multi-MB global doc. */
export async function readMongoGlobalVersion(): Promise<string | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    return await readPostgresGlobalVersion();
  } catch {
    return null;
  }
}

let mongoGlobalInflight: { key: string; promise: Promise<CompendiumGlobalDoc | null> } | null = null;

async function readMongoGlobalDocInner(
  opts: GlobalDocReadOptions = {},
): Promise<CompendiumGlobalDoc | null> {
  try {
    if (isCompendiumStorageUnavailable()) return null;
    const raw = await readRawGlobalDocFromPostgres({ includeImageData: opts.includeImageData !== false });
    if (!raw) return null;
    const normalized = normalizeOwlbearGlobalDoc(raw);
    if (!opts.includeImageData) {
      normalized.images = {};
      normalized.imagesData = {};
      normalized.entryImages = {};
    }
    return normalized;
  } catch (err) {
    warnMongoRead(
      `[Compendium] Postgres global read failed, using fallback: ${err instanceof Error ? err.message : err}`,
    );
    if (shouldResetMongoClient(err)) resetMongoClient();
    return null;
  }
}

export async function readMongoGlobalDoc(
  opts: GlobalDocReadOptions = {},
): Promise<CompendiumGlobalDoc | null> {
  const key = opts.includeImageData ? 'full' : 'lite';
  if (mongoGlobalInflight?.key === key) return mongoGlobalInflight.promise;

  const promise = readMongoGlobalDocInner(opts).finally(() => {
    if (mongoGlobalInflight?.promise === promise) mongoGlobalInflight = null;
  });
  mongoGlobalInflight = { key, promise };
  return promise;
}

let globalDocInflight: { key: string; promise: Promise<CompendiumGlobalDoc> } | null = null;

async function buildGlobalDoc(opts: GlobalDocReadOptions): Promise<CompendiumGlobalDoc> {
  const mongoOnly = process.env['COMPENDIUM_MONGO_ONLY'] === '1';

  if (mongoOnly) {
    const mongo = await readMongoGlobalDoc(opts);
    const merged = mongo ?? { ...EMPTY_GLOBAL };
    if (!opts.includeImageData) {
      setCachedGlobalLite(merged);
    }
    return merged;
  }

  const fallbackRaw = loadGlobalFallback(true);
  const fallback = fallbackRaw ? withFileMtime(fallbackRaw) : null;

  const skipExtension = process.env['OWLBear_SKIP_EXTENSION'] === '1';
  const extensionPromise = skipExtension ? Promise.resolve(null) : fetchExtensionGlobalDoc();
  const mongoPromise = readMongoGlobalDoc(opts);

  const [mongo, extension] = await Promise.all([mongoPromise, extensionPromise]);

  let merged: CompendiumGlobalDoc | null = mongo;
  if (merged && extension) merged = mergeGlobalDocs(merged, extension);
  else if (!merged && extension) merged = extension;

  if (merged && fallback) merged = mergeGlobalDocs(merged, fallback);
  else if (!merged && fallback) merged = { ...EMPTY_GLOBAL, ...fallback };
  else if (!merged) merged = { ...EMPTY_GLOBAL };

  if (!opts.includeImageData) {
    setCachedGlobalLite(merged);
  }
  return merged;
}

/** Merged view: Mongo + Owlbear extension + local data.json (newest source wins per field). */
export async function globalDoc(opts: GlobalDocReadOptions = {}): Promise<CompendiumGlobalDoc> {
  if (!opts.includeImageData) {
    const cached = getCachedGlobalLite();
    if (cached) return cached;
  }

  const key = opts.includeImageData ? 'full' : 'lite';
  if (globalDocInflight?.key === key) return globalDocInflight.promise;

  const promise = buildGlobalDoc(opts).finally(() => {
    if (globalDocInflight?.promise === promise) globalDocInflight = null;
  });
  globalDocInflight = { key, promise };
  return promise;
}

/** Authoritative global doc for writes — Mongo first, then local file mirror. */
async function readAuthoritativeGlobal(includeImageData: boolean): Promise<CompendiumGlobalDoc> {
  const mongo = await readMongoGlobalDoc({ includeImageData });
  if (mongo) return mongo;
  const fallback = loadGlobalFallback(true);
  if (fallback) return fallback;
  return { ...EMPTY_GLOBAL };
}

async function persistGlobalDoc(next: CompendiumGlobalDoc): Promise<CompendiumGlobalDoc> {
  if (!isCompendiumStorageUnavailable()) {
    markCompendiumWritePending();
    const { readRawGlobalDoc } = await import('./compendiumOwlbearPersist');
    const existing = await readRawGlobalDoc({ includeImageData: true });
    const postgresPayload: OwlbearRawGlobalDoc = {
      _id: 'global',
      monsters: existing.monsters ?? [],
      items: existing.items ?? [],
      spells: existing.spells ?? [],
      overrideMonsters: next.monsters ?? existing.overrideMonsters ?? [],
      overrideItems: next.items ?? existing.overrideItems ?? [],
      overrideSpells: next.spells ?? existing.overrideSpells ?? [],
      deleted: next.deleted ?? existing.deleted ?? [],
      images: next.images ?? existing.images ?? {},
      imagesData: next.imagesData ?? existing.imagesData ?? {},
      entryImages: next.entryImages ?? existing.entryImages ?? {},
      lockedSources: existing.lockedSources ?? [],
      publishedEntryKeys: existing.publishedEntryKeys ?? [],
      lastUpdated: next.lastUpdated,
    };
    await persistRawGlobalDocToPostgres(postgresPayload, new Date(next.lastUpdated));
    saveGlobalFallback(normalizeOwlbearGlobalDoc(postgresPayload), postgresPayload);
    notifyCompendiumChanged(next.lastUpdated);
    return normalizeOwlbearGlobalDoc(postgresPayload);
  }

  const saved = saveGlobalFallback(next);
  if (!saved) {
    throw new Error('PostgreSQL unavailable and no local data.json to write');
  }
  notifyCompendiumChanged(saved.lastUpdated);
  return saved;
}

/**
 * Atomic read-modify-write on the global compendium doc (queued).
 * Reads Mongo directly — never stale extension HTTP cache.
 */
export async function mutateGlobal(
  apply: (current: CompendiumGlobalDoc) => Partial<CompendiumGlobalDoc>,
): Promise<CompendiumGlobalDoc> {
  return enqueueCompendiumWrite(async () => {
    invalidateExtensionGlobalCache();
    clearGlobalFallbackCache();
    invalidateCompendiumCaches();

    const current = await readAuthoritativeGlobal(true);
    const partial = apply(current);
    const next: CompendiumGlobalDoc = {
      ...current,
      ...partial,
      _id: 'global',
      lastUpdated: new Date().toISOString(),
    };
    return persistGlobalDoc(next);
  });
}

/** Persist compendium overrides to MongoDB (primary) and data.json (mirror). */
export async function saveGlobal(partial: Partial<CompendiumGlobalDoc>): Promise<CompendiumGlobalDoc> {
  return mutateGlobal(() => partial);
}

/** On startup, reconcile Postgres compendium storage with local fallback mirror. */
export async function syncCompendiumStorageOnStartup(): Promise<void> {
  try {
    if (isCompendiumStorageUnavailable()) {
      console.log('[Compendium] PostgreSQL not available — writes will use local data.json');
      return;
    }

    invalidateExtensionGlobalCache();
    clearGlobalFallbackCache();

    const { scheduleFallbackMongoSync } = await import('./compendiumFallbackMongoSync');
    scheduleFallbackMongoSync('startup');

    const version = await readMongoGlobalVersion();
    if (version) {
      console.log(`[Compendium] Postgres compendium ready (rev ${version})`);
    }
  } catch (err) {
    console.warn(
      '[Compendium] Startup storage sync failed:',
      err instanceof Error ? err.message : err,
    );
  }
}
