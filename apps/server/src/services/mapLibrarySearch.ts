export interface WebMapHit {
  id: string;
  title: string;
  thumbUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  source: string;
  creator: string;
  license: string;
}

const PAGE = 16;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const batches = new Map<string, { at: number; results: WebMapHit[] }>();

/** Web image search (DuckDuckGo's image index). Each hit is labeled with the site that hosts it. */
export async function searchWebMaps(query: string, page: number): Promise<{ maps: WebMapHit[]; hasMore: boolean }> {
  const term = webQuery(query);
  const results = await loadBatch(term);
  const start = (page - 1) * PAGE;
  return {
    maps: results.slice(start, start + PAGE),
    hasMore: start + PAGE < results.length,
  };
}

function webQuery(query: string): string {
  const scene = query.trim().replace(/\s+/g, ' ');
  return `${scene} (dnd OR "d&d" OR battlemap OR "battle map" OR "dungeon map")`;
}

async function loadBatch(query: string): Promise<WebMapHit[]> {
  const key = query.toLowerCase();
  const cached = batches.get(key);
  if (cached && Date.now() - cached.at < 120_000) return cached.results;

  const vqd = await loadVqd(query);
  const res = await fetch(`https://duckduckgo.com/i.js?${new URLSearchParams({
    l: 'us-en',
    o: 'json',
    q: query,
    vqd,
    f: ',,,,,',
    p: '1',
  })}`, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://duckduckgo.com/' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Image search ${res.status}`);
  const data = (await res.json()) as { results?: DdgImage[] };
  const results = (data.results ?? [])
    .map(toHit)
    .filter((hit): hit is WebMapHit => hit != null);
  const unique = dedupe(results);
  batches.set(key, { at: Date.now(), results: unique });
  if (batches.size > 40) {
    const oldest = batches.keys().next().value;
    if (oldest) batches.delete(oldest);
  }
  return unique;
}

async function loadVqd(query: string): Promise<string> {
  const res = await fetch(`https://duckduckgo.com/?${new URLSearchParams({ q: query, iax: 'images', ia: 'images' })}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Image search home ${res.status}`);
  const html = await res.text();
  const vqd = html.match(/vqd="([^"]+)"/)?.[1]
    ?? html.match(/vqd='([^']+)'/)?.[1]
    ?? html.match(/vqd=([\d-]+)/)?.[1];
  if (!vqd) throw new Error('Image search token missing');
  return vqd;
}

function toHit(hit: DdgImage): WebMapHit | null {
  if (!hit.image || !hit.thumbnail || !hit.url) return null;
  if (!/^https:\/\//.test(hit.image)) return null;
  const width = hit.width ?? 0;
  const height = hit.height ?? 0;
  if (width > 0 && height > 0 && Math.max(width, height) < 480) return null;
  const title = (hit.title ?? '').replace(/\s+/g, ' ').trim();
  if (!isDndMap(title, hit.url)) return null;
  return {
    id: `web-${hash(hit.image)}`,
    title: title || siteLabel(hit.url),
    thumbUrl: hit.thumbnail,
    imageUrl: hit.image,
    width: width || 1920,
    height: height || 1080,
    source: siteLabel(hit.url),
    creator: '',
    license: '',
  };
}

const NOT_TABLETOP = /location map|relief map|\blocator\b|census|enumeration|railway|railroad|transit|street ?map|road ?map|topograph|ordnance|\bnat grid\b|\bgeograph\b|metro map|subway|tube map|bus map|administrative|political map|satellite|google earth|openstreetmap|\bgis\b|cadastre|zoning|provincial park|coat of arms|flag of|minecraft|fortnite|zelda|skyrim|warcraft|pokemon/i;
const BATTLE_MAP = /battle\s*-?\s*maps?|battlemaps?|dungeon\s*maps?|encounter maps?|dungeondraft|inkarnate/i;
const DND = /\bd\s*&\s*d\b|\bdnd\b|\b5e\b|\bvtt\b|roll20|foundry vtt/i;
const MAP_WORD = /\bmaps?\b/i;

function isDndMap(title: string, pageUrl: string): boolean {
  const text = `${title} ${pageUrl}`;
  if (NOT_TABLETOP.test(text)) return false;
  return BATTLE_MAP.test(text) || (DND.test(text) && MAP_WORD.test(text));
}

function siteLabel(pageUrl: string): string {
  try {
    const host = new URL(pageUrl).hostname.replace(/^www\./, '');
    const name = host.split('.')[0] ?? host;
    if (!name) return host;
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch {
    return 'Web';
  }
}

function dedupe(hits: WebMapHit[]): WebMapHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.imageUrl)) return false;
    seen.add(hit.imageUrl);
    return true;
  });
}

function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

interface DdgImage {
  title?: string;
  image?: string;
  thumbnail?: string;
  url?: string;
  width?: number;
  height?: number;
}
