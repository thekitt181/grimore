import { Texture } from 'pixi.js';
import { isDdbHostedImageUrl, proxiedDdbImageUrl } from '@/systems/ddb/ddbImageUrl';

const cache = new Map<string, Texture>();

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
    return texture;
  } catch (err) {
    throw err instanceof Error ? err : new Error('Failed to create texture');
  }
}

/**
 * Loads a PixiJS Texture from any URL — http/https, blob:, or data:.
 * D&D Beyond URLs are fetched via our same-origin proxy as blobs so WebGL can upload them.
 */
export async function loadTexture(url: string): Promise<Texture> {
  const resolved = proxiedDdbImageUrl(url);
  const cached = cache.get(resolved);
  if (cached && !cached.destroyed) return cached;

  const useBlob =
    isDdbHostedImageUrl(url)
    || resolved.startsWith('/api/ddb/proxy-image');

  const img = useBlob
    ? await loadViaBlob(resolved)
    : await loadImageElement(resolved, !resolved.startsWith('blob:') && !resolved.startsWith('data:'));

  return textureFromImage(img, resolved);
}

/** Remove a specific URL from the cache (e.g. after a token image changes). */
export function evictTexture(url: string) {
  cache.delete(proxiedDdbImageUrl(url));
}
