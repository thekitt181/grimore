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

const SVG_RASTER_PX = 256;

/** Pixi / WebGL often upload SVG textures as empty black — rasterize to PNG first. */
async function loadSvgRasterized(url: string): Promise<HTMLImageElement> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load SVG: ${url} (${res.status})`);
  const svgText = await res.text();
  const blobUrl = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
  try {
    const svgImg = await loadImageElement(blobUrl, false);
    const w = svgImg.naturalWidth > 0 ? svgImg.naturalWidth : SVG_RASTER_PX;
    const h = svgImg.naturalHeight > 0 ? svgImg.naturalHeight : SVG_RASTER_PX;
    const scale = SVG_RASTER_PX / Math.max(w, h, 1);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D unavailable');
    ctx.drawImage(svgImg, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/png');
    return loadImageElement(dataUrl, false);
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
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

function isPropSpriteUrl(url: string): boolean {
  const path = url.split('?')[0]?.toLowerCase() ?? '';
  return path.includes('/props/') && (path.endsWith('.png') || path.endsWith('.webp'));
}

const PROP_PUNCH_CACHE = 'punch3';

function textureCacheKey(url: string): string {
  const resolved = resolveTokenPortraitUrl(proxiedDdbImageUrl(url));
  return isPropSpriteUrl(url) || isPropSpriteUrl(resolved)
    ? `${resolved}#${PROP_PUNCH_CACHE}`
    : resolved;
}

/** Thumbnails are rendered on #12121a / near-black. Punch edge-connected backdrop so sprites sit on the map. */
function punchPropBackdrop(img: HTMLImageElement): HTMLCanvasElement | HTMLImageElement {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  if (w < 8 || h < 8) return img;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img;
  ctx.drawImage(img, 0, 0);
  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  const at = (x: number, y: number) => {
    const i = (y * w + x) * 4;
    return [px[i]!, px[i + 1]!, px[i + 2]!] as const;
  };
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
  const cr = Math.round(corners.reduce((s, c) => s + c[0], 0) / 4);
  const cg = Math.round(corners.reduce((s, c) => s + c[1], 0) / 4);
  const cb = Math.round(corners.reduce((s, c) => s + c[2], 0) / 4);
  const plateLum = (cr + cg + cb) / 3;
  const plateChroma = Math.abs(cr - cg) + Math.abs(cg - cb) + Math.abs(cr - cb);
  // Only strip a dark studio plate. Painted scenes and wood stay intact.
  if (plateLum > 42 || plateChroma > 28) return img;
  const backdrop = (i: number): boolean => {
    const a = px[i + 3]!;
    if (a < 12) return true;
    return (
      Math.abs(px[i]! - cr) <= 6
      && Math.abs(px[i + 1]! - cg) <= 6
      && Math.abs(px[i + 2]! - cb) <= 6
    );
  };
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const idx = y * w + x;
    if (seen[idx]) return;
    seen[idx] = 1;
    if (backdrop(idx * 4)) stack.push(idx);
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  let punched = 0;
  while (stack.length > 0) {
    const idx = stack.pop()!;
    const i = idx * 4;
    px[i + 3] = 0;
    punched += 1;
    const x = idx % w;
    const y = (idx / w) | 0;
    push(x - 1, y);
    push(x + 1, y);
    push(x, y - 1);
    push(x, y + 1);
  }
  if (punched < 16) return img;
  for (let i = 3; i < px.length; i += 4) {
    if (px[i]! > 0) px[i] = 255;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function textureFromImage(img: HTMLImageElement | HTMLCanvasElement, cacheKey: string): Texture {
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
export async function loadImageUrl(url: string): Promise<HTMLImageElement | HTMLCanvasElement> {
  const resolved = resolveTokenPortraitUrl(proxiedDdbImageUrl(url));
  const cacheKey = textureCacheKey(url);
  const cached = cache.get(cacheKey);
  if (cached && !cached.destroyed) {
    const resource = cached.source?.resource;
    if (resource instanceof HTMLImageElement || resource instanceof HTMLCanvasElement) return resource;
  }

  const path = resolved.split('?')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.svg')) {
    return loadSvgRasterized(resolved);
  }

  const useBlob =
    isDdbHostedImageUrl(url)
    || resolved.startsWith('/api/ddb/proxy-image')
    || resolved.startsWith('/api/compendium/proxy-image')
    || resolved.startsWith('/api/compendium/static-image');

  const img = useBlob
    ? await loadViaBlob(resolved)
    : await loadImageElement(resolved, !resolved.startsWith('blob:') && !resolved.startsWith('data:'));
  return isPropSpriteUrl(url) || isPropSpriteUrl(resolved) ? punchPropBackdrop(img) : img;
}

/**
 * Loads a PixiJS Texture from any URL — http/https, blob:, or data:.
 * D&D Beyond URLs are fetched via our same-origin proxy as blobs so WebGL can upload them.
 */
export async function loadTexture(url: string): Promise<Texture> {
  const cacheKey = textureCacheKey(url);
  const cached = cache.get(cacheKey);
  if (cached && !cached.destroyed) return cached;

  const img = await loadImageUrl(url);
  return textureFromImage(img, cacheKey);
}

/** Remove a specific URL from the cache (e.g. after a token image changes). */
export function evictTexture(url: string) {
  cache.delete(resolveTokenPortraitUrl(proxiedDdbImageUrl(url)));
  cache.delete(proxiedDdbImageUrl(url));
}
