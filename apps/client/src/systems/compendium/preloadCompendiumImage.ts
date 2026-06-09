import { withCompendiumImageCacheBust } from './compendiumImageUrl';

const preloaded = new Set<string>();

/** Warm the browser image cache before showing on map or in the reference panel. */
export function preloadCompendiumImageUrl(
  url: string | null | undefined,
  cacheVersion?: string | null,
): void {
  if (!url) return;
  const src = withCompendiumImageCacheBust(url, cacheVersion) ?? url;
  if (preloaded.has(src)) return;
  preloaded.add(src);
  const img = new Image();
  img.src = src;
}

export function preloadCompendiumImageUrls(
  urls: Array<string | null | undefined>,
  cacheVersion?: string | null,
): void {
  for (const url of urls) preloadCompendiumImageUrl(url, cacheVersion);
}
