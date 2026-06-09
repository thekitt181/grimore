type EntrySlice = {
  imageRef: string | null;
  entryHistory: string[];
  lastUpdated: string | null;
};

const SLICE_TTL_MS = 90_000;
const REF_TTL_MS = 90_000;
const BLOB_TTL_MS = 600_000;

const sliceCache = new Map<string, { at: number; data: EntrySlice }>();
const refCache = new Map<string, { at: number; data: string | null }>();
const blobCache = new Map<string, { at: number; data: string }>();

const sliceInflight = new Map<string, Promise<EntrySlice | null>>();
const refInflight = new Map<string, Promise<string | null>>();
const blobInflight = new Map<string, Promise<string | null>>();

function sliceKey(imageKey: string, entryName: string): string {
  return `${imageKey}\0${entryName}`;
}

function fresh<T>(entry: { at: number; data: T } | undefined, ttlMs: number): T | null {
  if (!entry) return null;
  if (Date.now() - entry.at > ttlMs) return null;
  return entry.data;
}

export function getCachedEntrySlice(imageKey: string, entryName: string): EntrySlice | null {
  return fresh(sliceCache.get(sliceKey(imageKey, entryName)), SLICE_TTL_MS);
}

export function setCachedEntrySlice(imageKey: string, entryName: string, data: EntrySlice): void {
  sliceCache.set(sliceKey(imageKey, entryName), { at: Date.now(), data });
}

export function getEntrySliceInflight(
  imageKey: string,
  entryName: string,
): Promise<EntrySlice | null> | null {
  return sliceInflight.get(sliceKey(imageKey, entryName)) ?? null;
}

export function setEntrySliceInflight(
  imageKey: string,
  entryName: string,
  promise: Promise<EntrySlice | null>,
): void {
  const key = sliceKey(imageKey, entryName);
  sliceInflight.set(key, promise);
  void promise.finally(() => {
    if (sliceInflight.get(key) === promise) sliceInflight.delete(key);
  });
}

export function getCachedImageRef(imageKey: string): string | null | undefined {
  const hit = fresh(refCache.get(imageKey), REF_TTL_MS);
  return hit === null ? undefined : hit;
}

export function setCachedImageRef(imageKey: string, data: string | null): void {
  refCache.set(imageKey, { at: Date.now(), data });
}

export function getImageRefInflight(imageKey: string): Promise<string | null> | null {
  return refInflight.get(imageKey) ?? null;
}

export function setImageRefInflight(imageKey: string, promise: Promise<string | null>): void {
  refInflight.set(imageKey, promise);
  void promise.finally(() => {
    if (refInflight.get(imageKey) === promise) refInflight.delete(imageKey);
  });
}

export function getCachedImageBlob(imageKey: string): string | null {
  return fresh(blobCache.get(imageKey), BLOB_TTL_MS);
}

export function setCachedImageBlob(imageKey: string, data: string): void {
  blobCache.set(imageKey, { at: Date.now(), data });
}

export function getImageBlobInflight(imageKey: string): Promise<string | null> | null {
  return blobInflight.get(imageKey) ?? null;
}

export function setImageBlobInflight(imageKey: string, promise: Promise<string | null>): void {
  blobInflight.set(imageKey, promise);
  void promise.finally(() => {
    if (blobInflight.get(imageKey) === promise) blobInflight.delete(imageKey);
  });
}

export function invalidateCompendiumImageMemoryCache(opts?: {
  imageKey?: string;
  entryName?: string;
}): void {
  if (!opts?.imageKey) {
    sliceCache.clear();
    refCache.clear();
    blobCache.clear();
    return;
  }
  const { imageKey, entryName } = opts;
  if (entryName) {
    sliceCache.delete(sliceKey(imageKey, entryName));
  } else {
    for (const key of sliceCache.keys()) {
      if (key.startsWith(`${imageKey}\0`)) sliceCache.delete(key);
    }
  }
  refCache.delete(imageKey);
  blobCache.delete(imageKey);
}
