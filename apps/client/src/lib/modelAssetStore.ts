/** Persist large GLB/STL blobs outside localStorage (refs stored on map/token items). */
export const GRIMOIRE_MODEL_PREFIX = 'grimoire-model://';

export type ModelAssetFormat = 'glb' | 'gltf' | 'stl';

const DB_NAME = 'grimoire-model-assets';
const STORE = 'assets';
const DB_VERSION = 1;

function assetKey(sessionId: string, itemId: string): string {
  return `${sessionId}:${itemId}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

function idbPut(key: string, value: Blob): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('IndexedDB put failed'));
        };
      }),
  );
}

function idbGet(key: string): Promise<Blob | undefined> {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => {
          db.close();
          resolve(req.result as Blob | undefined);
        };
        req.onerror = () => {
          db.close();
          reject(req.error ?? new Error('IndexedDB get failed'));
        };
      }),
  );
}

export function isGrimoireModelRef(url: string | null | undefined): url is string {
  return !!url && url.startsWith(GRIMOIRE_MODEL_PREFIX);
}

const FORMAT_PREFIX_RE = /^(glb|gltf|stl)\//i;

export function parseGrimoireModelRef(url: string): { format: ModelAssetFormat; key: string } | null {
  if (!isGrimoireModelRef(url)) return null;
  const rest = url.slice(GRIMOIRE_MODEL_PREFIX.length);
  const match = rest.match(FORMAT_PREFIX_RE);
  if (match) {
    const format = match[1]!.toLowerCase() as ModelAssetFormat;
    return { format, key: rest.slice(match[0].length) };
  }
  return { format: 'glb', key: rest };
}

export function toGrimoireModelRef(
  sessionId: string,
  itemId: string,
  format: ModelAssetFormat = 'glb',
): string {
  return `${GRIMOIRE_MODEL_PREFIX}${format}/${assetKey(sessionId, itemId)}`;
}

export async function saveModelAsset(
  sessionId: string,
  itemId: string,
  file: File | Blob,
  format: ModelAssetFormat = 'glb',
): Promise<string> {
  const key = assetKey(sessionId, itemId);
  await idbPut(key, file instanceof File ? file : file);
  return toGrimoireModelRef(sessionId, itemId, format);
}

export async function resolveModelAssetUrl(url: string): Promise<string> {
  if (!isGrimoireModelRef(url)) return url;
  const parsed = parseGrimoireModelRef(url);
  if (!parsed) return url;
  const blob = await idbGet(parsed.key);
  if (!blob) throw new Error('3D model asset not found in browser storage');
  return URL.createObjectURL(blob);
}

export async function hasModelAsset(url: string): Promise<boolean> {
  if (!isGrimoireModelRef(url)) return true;
  const parsed = parseGrimoireModelRef(url);
  if (!parsed) return false;
  const blob = await idbGet(parsed.key);
  return Boolean(blob);
}

export async function importModelAssetBlob(
  sessionId: string,
  itemId: string,
  format: ModelAssetFormat,
  blob: Blob,
): Promise<string> {
  await idbPut(assetKey(sessionId, itemId), blob);
  return toGrimoireModelRef(sessionId, itemId, format);
}

/** Inline data URLs blow localStorage quota — store blobs in IndexedDB instead. */
export function shouldUseModelAssetStore(file: File): boolean {
  return file.size > 256_000;
}

export async function persistModelFileForItem(
  sessionId: string | null,
  itemId: string,
  file: File,
  inlineDataUrl: string,
  format: ModelAssetFormat = 'glb',
): Promise<string> {
  if (!sessionId || !shouldUseModelAssetStore(file)) return inlineDataUrl;
  try {
    return await saveModelAsset(sessionId, itemId, file, format);
  } catch {
    return inlineDataUrl;
  }
}
