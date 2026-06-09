/** Append a cache-busting query param to uploaded static-image URLs (same key, new bytes). */
export function withCompendiumImageCacheBust(
  url: string | null | undefined,
  version?: string | null,
): string | null {
  if (!url) return null;
  if (!url.includes('static-image') || !version) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}v=${encodeURIComponent(version)}`;
}

/** Compare image URLs ignoring cache-bust query params. */
export function sameCompendiumImageUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const strip = (url: string) => url.replace(/([?&])v=[^&]+(&|$)/, '$1').replace(/[?&]$/, '');
  return strip(a) === strip(b);
}
