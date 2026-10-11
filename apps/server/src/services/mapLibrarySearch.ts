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
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const batches = new Map<string, { at: number; results: WebMapHit[] }>();
let googleChain: Promise<unknown> = Promise.resolve();
let googleBlockedUntil = 0;

/** One Google search at a time, so a few map searches do not get blocked. */
function enqueueGoogle<T>(work: () => Promise<T>): Promise<T> {
  const run = googleChain.then(work, work);
  googleChain = run.then(() => wait(800), () => wait(800));
  return run;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** D&D maps. Google Images first, then the web index if Google refuses. */
export async function searchWebMaps(query: string, page: number): Promise<{ maps: WebMapHit[]; hasMore: boolean }> {
  const term = query.trim().replace(/\s+/g, ' ').slice(0, 100);
  if (!term) return { maps: [], hasMore: false };
  const lookup = mapLookup(term);
  const results = await loadBatch(lookup, term);
  const start = (page - 1) * PAGE;
  return {
    maps: results.slice(start, start + PAGE),
    hasMore: start + PAGE < results.length,
  };
}

/** The typed phrase, plus dnd maps, so a tavern search stays a tabletop map. */
function mapLookup(term: string): string {
  if (/\bdnd maps?\b/i.test(term)) return term;
  return `${term} dnd maps`;
}

async function loadBatch(lookup: string, term: string): Promise<WebMapHit[]> {
  const key = lookup.toLowerCase();
  const cached = batches.get(key);
  if (cached && Date.now() - cached.at < 120_000) return cached.results;

  let hits: WebMapHit[] = [];
  if (Date.now() >= googleBlockedUntil) {
    try {
      hits = await enqueueGoogle(() => loadGoogle(lookup, term));
    } catch {
      hits = [];
    }
  }
  if (hits.length === 0) hits = await searchBingMaps(lookup, term);
  const unique = dedupe(hits);
  batches.set(key, { at: Date.now(), results: unique });
  if (batches.size > 40) {
    const oldest = batches.keys().next().value;
    if (oldest) batches.delete(oldest);
  }
  return unique;
}

async function loadGoogle(query: string, term: string, attempt = 0): Promise<WebMapHit[]> {
  const headers = {
    'User-Agent': UA,
    Accept: 'text/html,application/json',
    'Accept-Language': 'en-GB,en;q=0.9',
  };
  const home = await fetch(`https://www.google.com/search?${new URLSearchParams({ q: query, udm: '2', hl: 'en', gl: 'us' })}`, {
    headers,
    signal: AbortSignal.timeout(12_000),
  });
  const cookie = (home.headers.getSetCookie?.() ?? []).map((row) => row.split(';')[0]).join('; ');
  const res = await fetch(`https://www.google.com/search?${new URLSearchParams({
    q: query,
    tbm: 'isch',
    hl: 'en',
    gl: 'us',
    ijn: '0',
    start: '0',
    asearch: 'isch',
    async: '_fmt:json',
  })}`, {
    headers: { ...headers, Cookie: cookie, Referer: 'https://www.google.com/' },
    signal: AbortSignal.timeout(12_000),
  });
  if (res.status === 429) {
    googleBlockedUntil = Date.now() + 600_000;
    if (attempt < 1) {
      await wait(2500);
      return loadGoogle(query, term, attempt + 1);
    }
    return [];
  }
  if (!res.ok) return [];
  const text = await res.text();
  const wrapped = JSON.parse(text.replace(/^\)\]\}'\s*/, '')) as { ischj?: { results?: string } };
  const rows = JSON.parse(wrapped.ischj?.results ?? '[]') as GoogleImage[];
  const hits: WebMapHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const hit = googleHit(row, term);
    if (!hit || seen.has(hit.imageUrl)) continue;
    seen.add(hit.imageUrl);
    hits.push(hit);
    if (hits.length >= 24) break;
  }
  return hits;
}

async function searchBingMaps(query: string, term: string): Promise<WebMapHit[]> {
  const res = await fetch(`https://www.bing.com/images/async?${new URLSearchParams({
    q: query,
    first: '1',
    count: '35',
    adlt: 'off',
  })}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html', Referer: 'https://www.bing.com/' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const html = await res.text();
  const hits: WebMapHit[] = [];
  const seen = new Set<string>();
  for (const block of html.matchAll(/\bm="([^"]+)"/g)) {
    const hit = bingHit(block[1] ?? '', term);
    if (!hit || seen.has(hit.imageUrl)) continue;
    seen.add(hit.imageUrl);
    hits.push(hit);
    if (hits.length >= 24) break;
  }
  return hits;
}

function googleHit(row: GoogleImage, term: string): WebMapHit | null {
  const imageUrl = row.ou ?? '';
  const pageUrl = row.ru ?? '';
  const title = (row.pt ?? '').replace(/\s+/g, ' ').trim();
  const width = row.ow ?? 0;
  const height = row.oh ?? 0;
  if (!imageUrl.startsWith('https://') || !pageUrl.startsWith('https://') || !title) return null;
  if (width > 0 && height > 0 && Math.max(width, height) < 480) return null;
  if (!keepsMap(`${title} ${pageUrl} ${imageUrl}`, term)) return null;
  const thumbUrl = row.tu?.startsWith('https://') ? row.tu : imageUrl;
  return {
    id: `web-${hash(imageUrl)}`,
    title,
    thumbUrl,
    imageUrl,
    width: width || 1920,
    height: height || 1080,
    source: siteLabel(pageUrl),
    creator: (row.st ?? '').trim(),
    license: 'See source page',
  };
}

function bingHit(encoded: string, term: string): WebMapHit | null {
  let row: BingImage;
  try {
    row = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) as BingImage;
  } catch {
    return null;
  }
  const imageUrl = row.murl ?? '';
  const pageUrl = row.purl ?? '';
  const title = (row.t ?? '').replace(/\s+/g, ' ').trim();
  if (!imageUrl.startsWith('https://') || !pageUrl.startsWith('https://') || !title) return null;
  const blob = `${title} ${row.desc ?? ''} ${pageUrl} ${imageUrl}`;
  if (!keepsMap(blob, term)) return null;
  const thumbUrl = row.turl?.startsWith('https://') ? row.turl : imageUrl;
  return {
    id: `web-${hash(imageUrl)}`,
    title,
    thumbUrl,
    imageUrl,
    width: 1920,
    height: 1080,
    source: siteLabel(pageUrl),
    creator: '',
    license: 'See source page',
  };
}

const NOT_TABLETOP = /location map|relief map|\blocator\b|census|enumeration|railway|railroad|transit|street ?map|road ?map|topograph|ordnance|\bnat grid\b|\bgeograph\b|metro map|subway|tube map|bus map|administrative|political map|satellite|google earth|openstreetmap|\bgis\b|cadastre|zoning|provincial park|coat of arms|flag of|minecraft|fortnite|zelda|skyrim|warcraft|pokemon/i;
const BATTLE_MAP = /battle\s*-?\s*maps?|battlemaps?|dungeon\s*maps?|encounter maps?|dungeondraft|inkarnate/i;
const DND = /\bd\s*&\s*d\b|\bdnd\b|\b5e\b|\bvtt\b|roll20|foundry vtt/i;
const MAP_WORD = /\bmaps?\b/i;

const PLACE_STOP = new Set(['the', 'and', 'for', 'with', 'from', 'dnd', 'map', 'maps', 'battle', 'dungeon']);
const PORTRAIT = /\b(portraits?|character art|headshots?|tokens?)\b/i;

/** A street map is out. A picture counts when it is a map, or when it names the place and is a D&D map. */
function keepsMap(blob: string, term: string): boolean {
  if (NOT_TABLETOP.test(blob) || /\.svg(\?|$)/i.test(blob)) return false;
  if (/instagram\.com|facebook\.com|tiktok\.com/i.test(blob)) return false;
  const mapish = BATTLE_MAP.test(blob) || MAP_WORD.test(blob) || /\b(grid|vtt|dungeondraft|inkarnate)\b/i.test(blob);
  if (mapish) return true;
  if (PORTRAIT.test(blob)) return false;
  return mentionsPlace(blob, term) && DND.test(blob);
}

function mentionsPlace(blob: string, term: string): boolean {
  const words = term.toLowerCase().split(/[^a-z0-9-]+/).filter((word) => word.length > 2 && !PLACE_STOP.has(word));
  if (words.length === 0) return false;
  const text = blob.toLowerCase();
  return words.some((word) => text.includes(word));
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

interface BingImage {
  murl?: string;
  turl?: string;
  purl?: string;
  t?: string;
  desc?: string;
}

interface GoogleImage {
  ou?: string;
  ru?: string;
  tu?: string;
  pt?: string;
  st?: string;
  ow?: number;
  oh?: number;
}
