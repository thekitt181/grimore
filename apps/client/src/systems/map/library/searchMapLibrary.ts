export interface LibraryMap {
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

export interface MapLibraryPage {
  maps: LibraryMap[];
  hasMore: boolean;
}

const PAGE = 16;
const NOT_TABLETOP = /location map|relief map|\blocator\b|census|enumeration|railway|railroad|transit|street ?map|road ?map|topograph|ordnance|\bnat grid\b|\bgeograph\b|metro map|subway|tube map|bus map|administrative|political map|satellite|google earth|openstreetmap|\bgis\b|cadastre|zoning|provincial park|coat of arms|flag of|\blogo\b|\bicon\b|minecraft|fortnite|zelda|skyrim|warcraft|pokemon/i;
const BATTLE_MAP = /battle\s*-?\s*maps?|battlemaps?|dungeon\s*maps?|encounter maps?|dungeondraft|inkarnate/i;
const DND = /\bd\s*&\s*d\b|\bdnd\b|\b5e\b|\bvtt\b|roll20|foundry vtt/i;
const MAP_WORD = /\bmaps?\b/i;

/** Search D&D battle maps across the web image index, Wikimedia Commons, and Openverse. */
export async function searchMapLibrary(query: string, page: number): Promise<MapLibraryPage> {
  const term = query.trim();
  if (!term) return { maps: [], hasMore: false };

  const settled = await Promise.allSettled([
    searchWeb(term, page),
    searchCommons(term, page),
    searchOpenverse(term, page),
  ]);

  const groups: LibraryMap[][] = [];
  let hasMore = false;
  let reached = 0;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    reached += 1;
    groups.push(result.value.maps);
    if (result.value.hasMore) hasMore = true;
  }
  if (reached === 0) throw new Error('Map libraries unreachable');

  const seen = new Set<string>();
  const maps: LibraryMap[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let i = 0; i < longest; i += 1) {
    for (const group of groups) {
      const map = group[i];
      if (!map || seen.has(map.imageUrl)) continue;
      seen.add(map.imageUrl);
      maps.push(map);
    }
  }
  return { maps, hasMore };
}

async function searchWeb(query: string, page: number): Promise<MapLibraryPage> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  const res = await fetch(`/api/maps/library?${params}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(14_000),
  });
  if (!res.ok) throw new Error(`Web ${res.status}`);
  const data = (await res.json()) as { maps?: LibraryMap[]; hasMore?: boolean };
  const maps = (data.maps ?? []).filter((map): map is LibraryMap => (
    typeof map?.imageUrl === 'string' && map.imageUrl.startsWith('https://')
    && typeof map.thumbUrl === 'string' && map.thumbUrl.startsWith('https://')
    && typeof map.title === 'string'
    && typeof map.id === 'string'
  ));
  return { maps, hasMore: Boolean(data.hasMore) };
}

async function searchCommons(query: string, page: number): Promise<MapLibraryPage> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    generator: 'search',
    gsrsearch: `${query} (dnd OR "d&d" OR battlemap OR "battle map" OR "dungeon map") -geograph filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(PAGE),
    gsroffset: String((page - 1) * PAGE),
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName',
    iiurlwidth: '1400',
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, {
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Commons ${res.status}`);
  const data = (await res.json()) as CommonsResponse;
  const pages = Object.values(data.query?.pages ?? {});
  const maps = pages
    .map(toCommonsMap)
    .filter((map): map is LibraryMap => map != null);
  return { maps, hasMore: Boolean(data.continue) };
}

async function searchOpenverse(query: string, page: number): Promise<MapLibraryPage> {
  const params = new URLSearchParams({
    q: `${query} dnd battle map`,
    page: String(page),
    page_size: String(PAGE),
    extension: 'jpg,png,webp',
    filter_dead: 'true',
    mature: 'false',
  });
  const res = await fetch(`https://api.openverse.org/v1/images/?${params}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Openverse ${res.status}`);
  const data = (await res.json()) as OpenverseResponse;
  const maps = (data.results ?? [])
    .map(toOpenverseMap)
    .filter((map): map is LibraryMap => map != null);
  return { maps, hasMore: page < (data.page_count ?? page) };
}

function toCommonsMap(page: CommonsPage): LibraryMap | null {
  const info = page.imageinfo?.[0];
  if (!info?.thumburl || !info.url) return null;
  if (!/^image\/(jpeg|png|webp|gif)$/.test(info.mime ?? '')) return null;
  const width = info.thumbwidth || info.width || 0;
  const height = info.thumbheight || info.height || 0;
  const title = fileTitle(page.title ?? '');
  const useThumb = (info.size ?? 0) > 6_000_000;
  const imageUrl = useThumb ? info.thumburl : info.url;
  const placedWidth = useThumb ? width : (info.width || width);
  const placedHeight = useThumb ? height : (info.height || height);
  if (!usable(title, info.width || placedWidth, info.height || placedHeight)) return null;
  return {
    id: `commons-${page.pageid ?? title}`,
    title,
    thumbUrl: info.thumburl.replace(/\/\d+px-([^/]+)$/, '/320px-$1'),
    imageUrl: stripTracking(imageUrl),
    width: placedWidth || 1920,
    height: placedHeight || 1080,
    source: 'Wikimedia',
    creator: plain(info.extmetadata?.Artist?.value ?? ''),
    license: plain(info.extmetadata?.LicenseShortName?.value ?? ''),
  };
}

function toOpenverseMap(hit: OpenverseHit): LibraryMap | null {
  if (!hit.url || !hit.id) return null;
  const title = (hit.title ?? '').trim();
  const width = hit.width ?? 0;
  const height = hit.height ?? 0;
  if (!usable(title, width, height)) return null;
  return {
    id: `openverse-${hit.id}`,
    title,
    thumbUrl: hit.thumbnail || hit.url,
    imageUrl: hit.url,
    width: width || 1920,
    height: height || 1080,
    source: sourceLabel(hit.source ?? hit.provider ?? ''),
    creator: (hit.creator ?? '').trim(),
    license: (hit.license ?? '').toUpperCase(),
  };
}

function usable(title: string, width: number, height: number, pageUrl = ''): boolean {
  if (!isDndMap(title, pageUrl)) return false;
  if (width <= 0 || height <= 0) return true;
  return width >= 200 && height >= 200 && Math.max(width, height) >= 480;
}

function isDndMap(title: string, pageUrl: string): boolean {
  const text = `${title} ${pageUrl}`;
  if (NOT_TABLETOP.test(text)) return false;
  return BATTLE_MAP.test(text) || (DND.test(text) && MAP_WORD.test(text));
}

function fileTitle(title: string): string {
  return title.replace(/^File:/, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(/_/g, ' ').trim();
}

function plain(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTracking(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete('utm_source');
    parsed.searchParams.delete('utm_campaign');
    parsed.searchParams.delete('utm_content');
    const query = parsed.searchParams.toString();
    return query ? `${parsed.origin}${parsed.pathname}?${query}` : `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url;
  }
}

function sourceLabel(source: string): string {
  const known: Record<string, string> = {
    wikimedia: 'Wikimedia',
    flickr: 'Flickr',
    europeana: 'Europeana',
    smithsonian_institution: 'Smithsonian',
    rawpixel: 'Rawpixel',
    wordpress: 'WordPress',
    met: 'The Met',
    brooklyn_museum: 'Brooklyn Museum',
    digitalnz: 'DigitalNZ',
    stocksnap: 'StockSnap',
    finnish_heritage_agency: 'Finnish Heritage',
    nasa: 'NASA',
  };
  if (!source) return 'Openverse';
  return known[source] ?? source.replace(/_/g, ' ');
}

interface CommonsResponse {
  continue?: unknown;
  query?: { pages?: Record<string, CommonsPage> };
}

interface CommonsPage {
  pageid?: number;
  title?: string;
  imageinfo?: Array<{
    url?: string;
    thumburl?: string;
    mime?: string;
    size?: number;
    width?: number;
    height?: number;
    thumbwidth?: number;
    thumbheight?: number;
    extmetadata?: {
      Artist?: { value?: string };
      LicenseShortName?: { value?: string };
    };
  }>;
}

interface OpenverseResponse {
  page_count?: number;
  results?: OpenverseHit[];
}

interface OpenverseHit {
  id?: string;
  title?: string;
  url?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  source?: string;
  provider?: string;
  creator?: string;
  license?: string;
}
