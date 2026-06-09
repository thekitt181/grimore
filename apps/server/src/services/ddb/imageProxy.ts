import { normalizeCobaltToken } from './cobaltAuth';

const ALLOWED_HOSTS = ['www.dndbeyond.com', 'dndbeyond.com', 'media.dndbeyond.com'];

export function isAllowedDdbImageUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.dndbeyond.com'));
  } catch {
    return false;
  }
}

export async function fetchDdbImage(
  url: string,
  cobalt?: string | null,
): Promise<{ body: Buffer; contentType: string } | null> {
  if (!isAllowedDdbImageUrl(url)) return null;

  const headers: Record<string, string> = {
    Accept: 'image/*,*/*',
    'User-Agent': 'GrimoireVTT/1.0',
  };
  if (cobalt) {
    headers.Cookie = `CobaltSession=${normalizeCobaltToken(cobalt)}`;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) return null;

  const contentType = res.headers.get('content-type') ?? 'image/jpeg';
  const body = Buffer.from(await res.arrayBuffer());
  return { body, contentType };
}

/** Same-origin proxy path for clients (avoids DDB CORS on Pixi textures). */
export function ddbImageProxyPath(url: string): string {
  return `/api/ddb/proxy-image?url=${encodeURIComponent(url)}`;
}
