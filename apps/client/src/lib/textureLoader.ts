import { Texture } from 'pixi.js';
import { isDdbHostedImageUrl, proxiedDdbImageUrl } from '@/systems/ddb/ddbImageUrl';

const cache = new Map<string, Texture>();
const MAX_TEXTURE_CACHE = 200;

function trimTextureCache(): void {
  while (cache.size > MAX_TEXTURE_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest == null) break;
    const tex = cache.get(oldest);
    tex?.destroy(true);
    cache.delete(oldest);
  }
}

/** Rewrite portrait URLs so Pixi/WebGL can load them (same-origin, no CORS). */
export function resolveTokenPortraitUrl(url: string): string {
  if (!url) return url;
  if (
    url.startsWith('/api/compendium/static-image')
    || url.startsWith('/api/compendium/proxy-image')
    || url.startsWith('/api/ddb/proxy-image')
    || url.startsWith('data:')
    || url.startsWith('blob:')
  ) {
    return url;
  }

  if (url.includes('static-image')) {
    try {
      const key = new URL(url, 'https://grimoire.local').searchParams.get('key');
      if (key) return `/api/compendium/static-image?key=${encodeURIComponent(key)}`;
    } catch {
      /* fall through */
    }
  }

  if (/^https?:\/\//.test(url)) {
    return `/api/compendium/proxy-image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

function loadImageElement(src: string, crossOrigin: boolean): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (crossOrigin) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load texture: ${src}`));
    img.src = src;
  });
}

/** Blob URLs are never tainted — avoids WebGL SecurityError from DDB CDN images. */
async function loadViaBlob(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load texture: ${url} (${res.status})`);
  const blob = await res.blob();
  const blobUrl = URL.createObjectURL(blob);
  try {
    return await loadImageElement(blobUrl, false);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}

function textureFromImage(img: HTMLImageElement, cacheKey: string): Texture {
  try {
    const texture = Texture.from(img);
    cache.set(cacheKey, texture);
    trimTextureCache();
    return texture;
  } catch (err) {
    throw err instanceof Error ? err : new Error('Failed to create texture');
  }
}

/**
 * Load a decoded image using the same rules as the Pixi map renderer (proxy, blob, CORS).
 * Reuses the Pixi texture cache when the 2D map already loaded this URL.
 */
export async function loadImageUrl(url: string): Promise<HTMLImageElement> {
  const resolved = resolveTokenPortraitUrl(proxiedDdbImageUrl(url));
  const cached = cache.get(resolved);
  if (cached && !cached.destroyed) {
    const resource = cached.source?.resource;
    if (resource instanceof HTMLImageElement) return resource;
  }

  const useBlob =
    isDdbHostedImageUrl(url)
    || resolved.startsWith('/api/ddb/proxy-image')
    || resolved.startsWith('/api/compendium/proxy-image')
    || resolved.startsWith('/api/compendium/static-image');

  return useBlob
    ? loadViaBlob(resolved)
    : loadImageElement(resolved, !resolved.startsWith('blob:') && !resolved.startsWith('data:'));
}

/**
 * Loads a PixiJS Texture from any URL — http/https, blob:, or data:.
 * D&D Beyond URLs are fetched via our same-origin proxy as blobs so WebGL can upload them.
 */
export async function loadTexture(url: string): Promise<Texture> {
  const resolved = resolveTokenPortraitUrl(proxiedDdbImageUrl(url));
  const cached = cache.get(resolved);
  if (cached && !cached.destroyed) return cached;

  const img = await loadImageUrl(url);
  return textureFromImage(img, resolved);
}

/** Remove a specific URL from the cache (e.g. after a token image changes). */
export function evictTexture(url: string) {
  cache.delete(resolveTokenPortraitUrl(proxiedDdbImageUrl(url)));
  cache.delete(proxiedDdbImageUrl(url));
}
