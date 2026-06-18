import fs from 'fs';
import http from 'http';
import https from 'https';
import path from 'path';
import type { CompendiumGlobalDoc, CompendiumImageKind } from '@grimoire/shared';
import { compendiumImageKey, compendiumStaticImagePath, owlbearStaticImagePath, toOwlbearMongoImageRef } from '@grimoire/monster-dex';
import { type OwlbearImageFieldsPatch, applyMongoGlobalImagePatch } from './compendiumOwlbearPersist';
import {
  globalDoc,
  readMongoGlobalDoc,
  readMongoGlobalImageRefs,
  readMongoEntryImageSlice,
  readMongoImageRefKey,
  readMongoImageDataKey,
  readMongoEntryImageHistory,
  isoTimestamp,
} from './compendiumGlobal';

const MAX_HISTORY = 20;

function owlbearPublicRoots(): string[] {
  const roots: string[] = [];
  const dataDir = process.env['OWLBear_DATA_DIR'];
  if (dataDir) {
    const base = path.dirname(dataDir);
    roots.push(path.join(base, 'public'));
    roots.push(path.join(base, 'dist'));
  }
  roots.push(path.resolve(process.cwd(), '../../../owlbear_dnd_extension/public'));
  roots.push(path.resolve(process.cwd(), '../../../owlbear_dnd_extension/dist'));
  roots.push(path.resolve(__dirname, '../../data/compendium'));
  return [...new Set(roots)];
}

function assetApiPath(relativePath: string): string {
  const clean = relativePath.replace(/^\/+/, '');
  return `/api/compendium/asset/${clean.split('/').map(encodeURIComponent).join('/')}`;
}

function extractStaticKey(url: string): string | null {
  const match = url.match(/[?&]key=([^&]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

function hasStoredImageBlob(global: CompendiumGlobalDoc, key: string): boolean {
  const data = global.imagesData?.[key];
  return Boolean(data?.startsWith('data:image'));
}

function mappedImagePath(global: CompendiumGlobalDoc, key: string): string | null {
  const mapped = global.images?.[key];
  if (!mapped || mapped.includes('static-image')) return null;
  return mapped;
}

function resolveMappedPath(mapped: string): string {
  if (mapped.startsWith('/api/compendium/asset/')) return mapped;
  if (mapped.startsWith('/images/') || mapped.startsWith('images/')) {
    return assetApiPath(mapped.replace(/^\/+/, ''));
  }
  if (/^https?:\/\//.test(mapped)) return mapped;
  return mapped;
}

function isResolvableImageRef(global: CompendiumGlobalDoc, url: string): boolean {
  if (url.startsWith('data:image')) return true;
  if (/^https?:\/\//.test(url)) return true;
  if (url.startsWith('/api/compendium/asset/')) return true;
  if (url.startsWith('/images/') || url.startsWith('images/')) return true;
  if (url.includes('static-image')) {
    const key = extractStaticKey(url);
    if (!key) return false;
    if (hasStoredImageBlob(global, key)) return true;
    if (global.images?.[key]?.includes('static-image')) return true;
    const mapped = mappedImagePath(global, key);
    if (mapped?.startsWith('/api/compendium/asset/')) return true;
    if (mapped?.startsWith('/images/') || mapped?.startsWith('images/')) return true;
    if (mapped && /^https?:\/\//.test(mapped)) return true;
    return false;
  }
  return true;
}

function normalizeStoredUrl(url: string): string {
  if (url.startsWith('data:image')) return url;
  if (url.includes('/api/static-image') || url.includes('/api/compendium/static-image')) {
    const key = extractStaticKey(url);
    if (key) return compendiumStaticImagePath(key);
  }
  return url;
}

function addHistory(history: string[], url: string): string[] {
  const normalized = normalizeStoredUrl(url);
  const next = [normalized, ...history.filter((u) => u !== normalized)];
  return next.slice(0, MAX_HISTORY);
}

export function resolveEntryImageUrl(
  global: CompendiumGlobalDoc,
  kind: CompendiumImageKind,
  name: string,
  entryImage?: string,
): string | undefined {
  const key = compendiumImageKey(kind, name);
  const images = global.images ?? {};
  const imagesData = global.imagesData ?? {};
  const custom = images[key];

  if (custom) {
    if (custom.startsWith('data:image')) return compendiumStaticImagePath(key);
    if (/^https?:\/\//.test(custom)) return custom;
    if (custom.includes('static-image')) {
      const staticKey = extractStaticKey(custom);
      return staticKey ? compendiumStaticImagePath(staticKey) : compendiumStaticImagePath(key);
    }
    if (custom.startsWith('/api/compendium/asset/')) return custom;
    if (custom.startsWith('/images/') || custom.startsWith('images/')) {
      const rel = custom.replace(/^\/+/, '');
      return assetApiPath(rel);
    }
  }

  if (imagesData[key]) return compendiumStaticImagePath(key);

  if (entryImage) {
    if (entryImage.startsWith('data:image')) return entryImage;
    if (/^https?:\/\//.test(entryImage)) return entryImage;
    if (entryImage.includes('static-image')) {
      const staticKey = extractStaticKey(entryImage);
      return staticKey ? compendiumStaticImagePath(staticKey) : undefined;
    }
    const rel = entryImage.replace(/^\/+/, '');
    return assetApiPath(rel);
  }

  return undefined;
}

export function resolveHistoryUrl(global: CompendiumGlobalDoc, url: string): string {
  if (url.startsWith('data:image')) {
    return url;
  }
  if (/^https?:\/\//.test(url)) return url;
  if (url.includes('static-image')) {
    const key = extractStaticKey(url);
    if (key) {
      if (hasStoredImageBlob(global, key)) return compendiumStaticImagePath(key);
      const mapped = mappedImagePath(global, key);
      if (mapped) return resolveMappedPath(mapped);
    }
    return normalizeStoredUrl(url);
  }
  if (url.startsWith('/api/compendium/asset/')) return url;
  if (url.startsWith('/images/') || url.startsWith('images/')) {
    return assetApiPath(url.replace(/^\/+/, ''));
  }
  return url;
}

export async function getGlobalDocForImages(): Promise<CompendiumGlobalDoc> {
  const refs = await readMongoGlobalImageRefs();
  if (refs) {
    return {
      _id: 'global',
      monsters: [],
      items: [],
      spells: [],
      deleted: [],
      images: refs.images,
      imagesData: {},
      entryImages: refs.entryImages,
      lastUpdated: refs.lastUpdated,
    };
  }
  const mongo = await readMongoGlobalDoc({ includeImageData: true });
  if (mongo) return mongo;
  return globalDoc({ includeImageData: true });
}

export async function getEntryImageState(
  kind: CompendiumImageKind,
  name: string,
  entryImage?: string,
): Promise<{ key: string; current: string | null; history: string[]; library: string[]; updatedAt?: string }> {
  const key = compendiumImageKey(kind, name);
  const slice = await readMongoEntryImageSlice(key, name);
  const global = globalFromEntrySlice(key, name, slice);
  return buildEntryImageStateResponse(global, kind, name, entryImage);
}

function globalFromEntrySlice(
  imageKey: string,
  entryName: string,
  slice: {
    imageRef: string | null;
    entryHistory: string[];
    lastUpdated: string | null;
  } | null,
): CompendiumGlobalDoc {
  const images: Record<string, string> = {};
  if (slice?.imageRef) images[imageKey] = slice.imageRef;
  const entryImages: Record<string, string[]> = {};
  if (slice?.entryHistory.length) entryImages[entryName] = slice.entryHistory;
  return {
    _id: 'global',
    monsters: [],
    items: [],
    spells: [],
    deleted: [],
    images,
    imagesData: {},
    entryImages,
    lastUpdated: slice?.lastUpdated ?? new Date(0).toISOString(),
  };
}

export async function resolveCompendiumEntryImageUrl(
  kind: CompendiumImageKind,
  name: string,
  entryImage?: string,
): Promise<string | undefined> {
  const key = compendiumImageKey(kind, name);
  const slice = await readMongoEntryImageSlice(key, name);
  const global = globalFromEntrySlice(key, name, slice);
  return resolveEntryImageUrl(global, kind, name, entryImage);
}

function buildEntryImageStateResponse(
  global: CompendiumGlobalDoc,
  kind: CompendiumImageKind,
  name: string,
  entryImage?: string,
): { key: string; current: string | null; history: string[]; library: string[]; updatedAt?: string } {
  const key = compendiumImageKey(kind, name);
  const current = resolveEntryImageUrl(global, kind, name, entryImage) ?? null;
  const rawHistory = global.entryImages?.[name] ?? [];
  const history = rawHistory
    .map((u) => resolveHistoryUrl(global, u))
    .filter((u) => isResolvableImageRef(global, u) || u.includes('static-image') || /^https?:\/\//.test(u));
  if (current && !history.some((h) => sameCompendiumImageUrl(h, current))) {
    history.unshift(current);
  }
  return {
    key,
    current,
    history: history.slice(0, MAX_HISTORY),
    library: [],
    updatedAt: isoTimestamp(global.lastUpdated),
  };
}

function sameCompendiumImageUrl(a: string, b: string): boolean {
  const strip = (url: string) => url.replace(/([?&])v=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
  return strip(a) === strip(b);
}

export async function saveEntryImage(
  kind: CompendiumImageKind,
  name: string,
  imageUrl: string | null,
  entryImage?: string,
): Promise<{ key: string; current: string | null; history: string[]; library: string[]; updatedAt?: string }> {
  const key = compendiumImageKey(kind, name);
  let history = await readMongoEntryImageHistory(name);
  const removeImageKeys: string[] = [];
  const removeImageDataKeys: string[] = [];
  const imagesDataPatch: Record<string, string> = {};
  let imageRef: string | null = null;

  if (!imageUrl) {
    removeImageKeys.push(key);
    removeImageDataKeys.push(key);
  } else if (imageUrl.startsWith('data:image')) {
    const previousData = await readMongoImageDataKey(key);
    if (previousData?.startsWith('data:image')) {
      history = addHistory(history, previousData);
    }
    imagesDataPatch[key] = imageUrl;
    imageRef = owlbearStaticImagePath(key);
  } else if (imageUrl.includes('static-image')) {
    const staticKey = extractStaticKey(imageUrl);
    if (staticKey && staticKey !== key) {
      throw new Error('That image belongs to another compendium entry. Upload a new image for this entry.');
    }
    if (staticKey) {
      const blob = await readMongoImageDataKey(staticKey);
      if (blob) {
        imageRef = owlbearStaticImagePath(key);
      } else {
        const mapped = await readMongoImageRefKey(staticKey);
        if (mapped && !mapped.includes('static-image')) {
          imageRef = toOwlbearMongoImageRef(mapped);
          removeImageDataKeys.push(key);
        } else {
          throw new Error('That image is no longer in storage. Upload again or pick another thumbnail.');
        }
      }
    } else {
      imageRef = toOwlbearMongoImageRef(normalizeStoredUrl(imageUrl));
    }
  } else if (/^https?:\/\//.test(imageUrl)) {
    imageRef = imageUrl;
    removeImageDataKeys.push(key);
  } else if (imageUrl.startsWith('/api/compendium/asset/') || imageUrl.startsWith('images/') || imageUrl.startsWith('/images/')) {
    const rel = imageUrl.startsWith('/api/compendium/asset/')
      ? decodeURIComponent(imageUrl.slice('/api/compendium/asset/'.length))
      : imageUrl.replace(/^\/+/, '');
    imageRef = toOwlbearMongoImageRef(`/${rel}`);
    removeImageDataKeys.push(key);
  } else {
    throw new Error('Invalid image URL');
  }

  if (imageUrl) {
    history = addHistory(history, imageRef ?? imageUrl);
  }

  const storedEntryImage = imageUrl
    ? toOwlbearMongoImageRef(imageRef ?? imageUrl)
    : entryImage;

  const patch: OwlbearImageFieldsPatch = {
    entryImages: { [name]: imageUrl ? history : [] },
    removeImageKeys: removeImageKeys.length ? removeImageKeys : undefined,
    removeImageDataKeys: removeImageDataKeys.length ? removeImageDataKeys : undefined,
  };

  if (imageUrl && imageRef) {
    patch.images = { [key]: imageRef };
    if (Object.keys(imagesDataPatch).length > 0) {
      patch.imagesData = imagesDataPatch;
    }
  }

  const saved = await applyMongoGlobalImagePatch(patch);

  const global = globalFromEntrySlice(key, name, {
    imageRef: imageUrl ? imageRef : null,
    entryHistory: patch.entryImages?.[name] ?? [],
    lastUpdated: saved.lastUpdated ? isoTimestamp(saved.lastUpdated) : null,
  });

  return buildEntryImageStateResponse(global, kind, name, storedEntryImage);
}

export async function serveStaticImage(key: string, res: import('express').Response): Promise<void> {
  const [pathOrUrl, rawData] = await Promise.all([
    readMongoImageRefKey(key),
    readMongoImageDataKey(key),
  ]);

  if (pathOrUrl?.startsWith('/api/compendium/asset/')) {
    const rel = decodeURIComponent(pathOrUrl.slice('/api/compendium/asset/'.length));
    serveAssetFile(rel, res);
    return;
  }

  if (pathOrUrl && (pathOrUrl.startsWith('/images/') || pathOrUrl.startsWith('images/'))) {
    const rel = pathOrUrl.replace(/^\/+/, '');
    const served = tryServeAssetFile(rel, res);
    if (served) return;
  }

  if (rawData?.startsWith('data:image')) {
    const matches = rawData.match(/^data:image\/([a-zA-Z0-9+\.-]+);base64,(.+)$/);
    if (!matches?.[2]) {
      res.status(400).json({ error: 'Invalid stored image data' });
      return;
    }
    let ext = matches[1]!;
    if (ext === 'svg+xml') ext = 'svg';
    const buffer = Buffer.from(matches[2], 'base64');
    res.setHeader('Content-Type', `image/${ext}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(buffer);
    return;
  }

  if (pathOrUrl && /^https?:\/\//.test(pathOrUrl)) {
    await proxyExternalImage(pathOrUrl, res);
    return;
  }

  res.status(404).json({ error: 'Image not found' });
}

function tryServeAssetFile(relativePath: string, res: import('express').Response): boolean {
  for (const root of owlbearPublicRoots()) {
    const filePath = path.join(root, relativePath);
    const normalizedRoot = path.resolve(root);
    const normalizedFile = path.resolve(filePath);
    if (!normalizedFile.startsWith(normalizedRoot)) continue;
    if (fs.existsSync(normalizedFile)) {
      res.sendFile(normalizedFile);
      return true;
    }
  }
  return false;
}

export function serveAssetFile(relativePath: string, res: import('express').Response): void {
  const clean = relativePath.replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '');
  if (tryServeAssetFile(clean, res)) return;
  res.status(404).json({ error: 'Asset not found' });
}

function proxyExternalImage(url: string, res: import('express').Response): Promise<void> {
  return new Promise((resolve) => {
    try {
      const target = new URL(url);
      const protocol = target.protocol === 'https:' ? https : http;
      protocol.get(url, (proxyRes) => {
        res.status(proxyRes.statusCode ?? 502);
        if (proxyRes.headers['content-type']) {
          res.setHeader('Content-Type', proxyRes.headers['content-type']);
        }
        proxyRes.pipe(res);
        proxyRes.on('end', resolve);
      }).on('error', () => {
        res.status(502).json({ error: 'Failed to proxy image' });
        resolve();
      });
    } catch {
      res.status(400).json({ error: 'Invalid URL' });
      resolve();
    }
  });
}
