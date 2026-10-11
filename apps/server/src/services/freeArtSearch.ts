import { parseArtQuery, scoreText, type ArtQuery } from '@grimoire/shared';
import { searchGoogleCharacters } from './googleCharacterSearch';
import type { WebMapHit } from './mapLibrarySearch';

const UA = 'GrimoireVTT/1.0 (fantasy tabletop; +https://grimore.co.uk)';
const PAGE = 8;
const MAP_HINT = /\b(maps?|dungeons?|tilesets?|tiles?|caves?|castles?|towns?|villages?|interiors?|roguelikes?|terrains?|battles?)\b/i;
const SKIP_AUDIO = /\b(music|sound|sfx|audio|interface|ui pack)\b/i;
const RESTRICTED = /noncommercial|\bnc\b|noderiv|no deriv|all rights reserved/i;

/** Public search-only key shipped in game-icons.net's own page script. */
const GAME_ICONS_APP = '9HQ1YXUKVC';
const GAME_ICONS_KEY = 'fa437c6f1fcba0f93608721397cd515d';

export interface CharacterArtHit {
  id: string;
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  source: string;
  creator: string;
  license: string;
}

interface ArtPage<T> {
  hits: T[];
  hasMore: boolean;
}

interface CatalogPack {
  id?: string;
  title?: string;
  genres?: string[];
  tags?: string[];
  license?: string;
  credit?: string;
  source_page?: string;
  path?: string;
}

let catalogCache: { at: number; packs: CatalogPack[] } | null = null;

/** D&D character portraits. Pack sites stay on the map search; they are sprites and tiles, not portraits. */
export async function searchCharacterArt(query: string, page: number): Promise<{ portraits: CharacterArtHit[]; hasMore: boolean }> {
  if (page !== 1) return { portraits: [], hasMore: false };
  const parsed = parseArtQuery(query, 'character');
  const hits = await searchGoogleCharacters(query.trim());
  return { portraits: rankHits(hits, parsed), hasMore: false };
}

/** Map and tileset packs from the sites that actually publish them. Game-icons does not. */
export async function searchMapPacks(query: string, page: number): Promise<{ maps: WebMapHit[]; hasMore: boolean }> {
  const parsed = parseArtQuery(query, 'map');
  const settled = await Promise.allSettled([
    searchOpenGameArt(parsed, page, true),
    page === 1 ? searchKenney(parsed, true) : Promise.resolve({ hits: [], hasMore: false }),
    searchTiddybub(parsed, page, true),
  ]);
  const merged = merge(settled);
  merged.portraits = rankHits(merged.portraits, parsed);
  return {
    maps: merged.portraits.map((hit) => ({
      id: hit.id,
      title: hit.title,
      thumbUrl: hit.thumbUrl,
      imageUrl: hit.imageUrl,
      width: 1200,
      height: 1200,
      source: hit.source,
      creator: hit.creator,
      license: hit.license,
    })),
    hasMore: merged.hasMore,
  };
}

function merge(settled: PromiseSettledResult<ArtPage<CharacterArtHit>>[]): { portraits: CharacterArtHit[]; hasMore: boolean } {
  const groups: CharacterArtHit[][] = [];
  let hasMore = false;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    groups.push(result.value.hits);
    if (result.value.hasMore) hasMore = true;
  }
  const seen = new Set<string>();
  const portraits: CharacterArtHit[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let i = 0; i < longest; i += 1) {
    for (const group of groups) {
      const hit = group[i];
      if (!hit || seen.has(hit.imageUrl)) continue;
      seen.add(hit.imageUrl);
      portraits.push(hit);
    }
  }
  return { portraits, hasMore };
}

async function searchOpenGameArt(parsed: ArtQuery, page: number, maps: boolean): Promise<ArtPage<CharacterArtHit>> {
  const phrases = page === 1 ? [parsed.detailed, ...parsed.broader.slice(0, 2)] : [parsed.detailed];
  const unique = [...new Set(phrases.map((phrase) => phrase.trim()).filter(Boolean))];
  const settled = await Promise.allSettled(unique.map((phrase) => fetchOpenGameArt(phrase, page, maps, parsed.words)));
  const hits: CharacterArtHit[] = [];
  const seen = new Set<string>();
  let hasMore = false;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.hasMore) hasMore = true;
    for (const hit of result.value.hits) {
      if (seen.has(hit.imageUrl)) continue;
      seen.add(hit.imageUrl);
      hits.push(hit);
    }
  }
  hits.sort((a, b) => scoreHit(b, parsed) - scoreHit(a, parsed));
  return { hits: hits.slice(0, PAGE), hasMore };
}

async function fetchOpenGameArt(query: string, page: number, maps: boolean, words: string[]): Promise<ArtPage<CharacterArtHit>> {
  const keys = maps && !/\bmaps?\b/i.test(query) ? `${query} map` : query;
  const url = `https://opengameart.org/art-search-advanced?${new URLSearchParams({
    keys,
    page: String(Math.max(0, page - 1)),
  })}`;
  const html = await getText(url);
  const hits: CharacterArtHit[] = [];
  const pattern = /<span class="art-preview-title"><a href="(\/content\/[^"]+)">([^<]*)<\/a><\/span>[\s\S]*?<img src='([^']+)'/g;
  for (const match of html.matchAll(pattern)) {
    const path = match[1] ?? '';
    const title = decode(match[2] ?? '').trim();
    const thumb = match[3] ?? '';
    if (!path || !title || !thumb.startsWith('https://')) continue;
    if (SKIP_AUDIO.test(title)) continue;
    if (maps ? !matchesMap(title, words) : MAP_HINT.test(title)) continue;
    const imageUrl = thumb.replace(/\/styles\/[^/]+\/public\//, '/');
    hits.push({
      id: `oga-${path.replace(/^\/content\//, '')}`,
      title,
      thumbUrl: thumb,
      imageUrl,
      pageUrl: `https://opengameart.org${path}`,
      source: 'OpenGameArt',
      creator: 'OpenGameArt',
      license: 'See asset page',
    });
    if (hits.length >= PAGE) break;
  }
  return { hits, hasMore: hits.length >= PAGE };
}

async function searchKenney(parsed: ArtQuery, maps: boolean): Promise<ArtPage<CharacterArtHit>> {
  const terms = lookupTerms(parsed);
  const settled = await Promise.allSettled(terms.map((term) => fetchKenney(term, maps, parsed.words)));
  const hits: CharacterArtHit[] = [];
  const seen = new Set<string>();
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    for (const hit of result.value.hits) {
      if (seen.has(hit.pageUrl)) continue;
      seen.add(hit.pageUrl);
      hits.push(hit);
    }
  }
  hits.sort((a, b) => scoreHit(b, parsed) - scoreHit(a, parsed));
  return { hits: hits.slice(0, PAGE), hasMore: false };
}

async function fetchKenney(query: string, maps: boolean, words: string[]): Promise<ArtPage<CharacterArtHit>> {
  const html = (await getText(`https://kenney.nl/assets?${new URLSearchParams({ search: query })}`)).replace(/\s+/g, ' ');
  const hits: CharacterArtHit[] = [];
  const pattern = /<a href='(https:\/\/kenney\.nl\/assets\/[a-z0-9-]+)'>\s*<div class='cover' style='background-image:url\("([^"]+)"\)'><\/div>\s*<\/a>\s*<h2><a[^>]*>([^<]+)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const pageUrl = match[1] ?? '';
    const imageUrl = match[2] ?? '';
    const title = decode(match[3] ?? '').trim();
    if (!pageUrl || !imageUrl.startsWith('https://') || !title) continue;
    if (SKIP_AUDIO.test(title)) continue;
    if (maps && !matchesMap(title, words)) continue;
    if (!maps && MAP_HINT.test(title) && !/\b(characters?|creatures?|people|heroes|heros?|monsters?|animals?|npcs?)\b/i.test(title)) continue;
    const slug = pageUrl.split('/').pop() ?? title;
    hits.push({
      id: `kenney-${slug}`,
      title,
      thumbUrl: imageUrl,
      imageUrl,
      pageUrl,
      source: 'Kenney',
      creator: 'Kenney',
      license: 'CC0',
    });
    if (hits.length >= PAGE) break;
  }
  return { hits, hasMore: false };
}

async function searchTiddybub(parsed: ArtQuery, page: number, maps: boolean): Promise<ArtPage<CharacterArtHit>> {
  const packs = await loadCatalog();
  const ranked = packs
    .map((pack) => ({ pack, score: packScore(pack, parsed, maps) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  const start = (page - 1) * PAGE;
  const slice = ranked.slice(start, start + PAGE);
  const hits = slice.flatMap(({ pack }) => {
    const hit = toPackHit(pack);
    return hit ? [hit] : [];
  });
  return { hits, hasMore: start + PAGE < ranked.length };
}

async function searchGameIcons(parsed: ArtQuery, page: number): Promise<ArtPage<CharacterArtHit>> {
  const terms = page === 1 ? lookupTerms(parsed) : [parsed.detailed];
  const settled = await Promise.allSettled(terms.map((term) => queryGameIcons(term, page === 1 ? 1 : page)));
  const hits: CharacterArtHit[] = [];
  const seen = new Set<string>();
  let hasMore = false;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    if (result.value.hasMore) hasMore = true;
    for (const hit of result.value.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
  }
  hits.sort((a, b) => scoreHit(b, parsed) - scoreHit(a, parsed));
  return { hits: hits.slice(0, PAGE), hasMore };
}

async function queryGameIcons(query: string, page: number): Promise<ArtPage<CharacterArtHit>> {
  const res = await fetch(`https://${GAME_ICONS_APP}-dsn.algolia.net/1/indexes/icons/query`, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': GAME_ICONS_APP,
      'X-Algolia-API-Key': GAME_ICONS_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, hitsPerPage: PAGE, page: page - 1 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`game-icons ${res.status}`);
  const data = (await res.json()) as { nbPages?: number; hits?: Array<{ name?: string; id?: string }> };
  const hits: CharacterArtHit[] = [];
  for (const hit of data.hits ?? []) {
    const id = hit.id ?? '';
    const title = (hit.name ?? '').trim();
    const parts = id.split('/');
    if (parts.length < 3 || !title) continue;
    const creator = parts[1] ?? 'game-icons';
    const imageUrl = `https://game-icons.net/icons/ffffff/000000/${id}.svg`;
    hits.push({
      id: `game-icons-${id.replace(/\//g, '-')}`,
      title,
      thumbUrl: imageUrl,
      imageUrl,
      pageUrl: `https://game-icons.net/${id}.html`,
      source: 'game-icons',
      creator,
      license: 'CC BY 3.0',
    });
  }
  return { hits, hasMore: page < (data.nbPages ?? page) };
}

async function loadCatalog(): Promise<CatalogPack[]> {
  if (catalogCache && Date.now() - catalogCache.at < 6 * 60 * 60 * 1000) return catalogCache.packs;
  const res = await fetch('https://raw.githubusercontent.com/Tiddybub/2d-assets/main/catalog.json', {
    headers: { Accept: 'application/json', 'User-Agent': UA },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`Tiddybub ${res.status}`);
  const data = (await res.json()) as { assets?: CatalogPack[] };
  const packs = data.assets ?? [];
  catalogCache = { at: Date.now(), packs };
  return packs;
}

function toPackHit(pack: CatalogPack): CharacterArtHit | null {
  const id = pack.id ?? '';
  const title = (pack.title ?? '').trim();
  const path = pack.path ?? '';
  const license = (pack.license ?? '').trim();
  if (!id || !title || !path || RESTRICTED.test(license)) return null;
  const imageUrl = `https://raw.githubusercontent.com/Tiddybub/2d-assets/main/${path}/Preview.png`;
  return {
    id: `tiddybub-${id}`,
    title,
    thumbUrl: imageUrl,
    imageUrl,
    pageUrl: pack.source_page || `https://github.com/Tiddybub/2d-assets/tree/main/${path}`,
    source: 'Tiddybub',
    creator: (pack.credit ?? '').trim() || 'Tiddybub',
    license: license || 'See pack',
  };
}

function packScore(pack: CatalogPack, parsed: ArtQuery, maps: boolean): number {
  const genres = pack.genres ?? [];
  const tags = pack.tags ?? [];
  const characterPack = genres.includes('characters') || tags.some((tag) => /character|creature|npc|monster|people/.test(tag));
  const mapPack = genres.includes('tiles-terrain') || tags.some((tag) => /tile|map|dungeon|terrain/.test(tag));
  if (SKIP_AUDIO.test(`${pack.title ?? ''} ${tags.join(' ')}`)) return 0;
  if (maps ? !mapPack : !characterPack) return 0;
  const haystack = `${pack.title ?? ''} ${pack.id ?? ''} ${tags.join(' ')} ${genres.join(' ')}`;
  return scoreText(haystack, parsed.keywords, parsed.words);
}

function matchesMap(title: string, words: string[]): boolean {
  if (MAP_HINT.test(title)) return true;
  const lower = title.toLowerCase();
  return words.some((word) => word.length > 2 && lower.includes(word));
}

function lookupTerms(parsed: ArtQuery): string[] {
  const terms: string[] = [];
  const add = (value: string) => {
    for (const part of value.split(/\s+/)) {
      if (part.length > 2 && !terms.includes(part) && terms.length < 4) terms.push(part);
    }
  };
  add(parsed.detailed);
  for (const phrase of parsed.broader) add(phrase);
  if (terms.length === 0 && parsed.detailed) terms.push(parsed.detailed);
  return terms;
}

function scoreHit(hit: CharacterArtHit, parsed: ArtQuery): number {
  return scoreText(`${hit.title} ${hit.creator}`, parsed.keywords, parsed.words);
}

function rankHits(hits: CharacterArtHit[], parsed: ArtQuery): CharacterArtHit[] {
  return hits
    .filter((hit) => hit.source === 'Google Images' || hit.source === 'Web' || scoreHit(hit, parsed) > 0)
    .sort((a, b) => scoreHit(b, parsed) - scoreHit(a, parsed));
}

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.text();
}

function decode(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
