/** D&D Beyond CDN URLs block browser CORS — load via our same-origin proxy for Pixi/WebGL. */

export function isDdbHostedImageUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'dndbeyond.com' || host.endsWith('.dndbeyond.com');
  } catch {
    return false;
  }
}

export function proxiedDdbImageUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith('/api/ddb/proxy-image')) return url;
  if (!isDdbHostedImageUrl(url)) return url;
  return `/api/ddb/proxy-image?url=${encodeURIComponent(url)}`;
}

export function resolveTokenImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return proxiedDdbImageUrl(url);
}
