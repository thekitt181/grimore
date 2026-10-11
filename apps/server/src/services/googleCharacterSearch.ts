const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface GoogleCharacterHit {
  id: string;
  title: string;
  thumbUrl: string;
  imageUrl: string;
  pageUrl: string;
  source: string;
  creator: string;
  license: string;
}

/** Real people, maps, idea boards, commodities, and generated pictures are not a D&D character. */
const SKIP = /\b(cosplays?|cosplayer|selfie|photograph|photoshoot|photo shoot|real life|\birl\b|actor|actress|celebrity|meme|screenshot|logo|headshots?|businessman|business man|stock photos?|battle ?map|dungeon map|world map|rulebook|dice set|sprites?|spritesheets?|chibi|pixel|8-?bit|16-?bit|tilesets?|asset packs?|art packs?|rpg maker|ideas|gold bars?|silver bars?|bullion|ingots?|gold coins?|silver coins?|krugerrand|karats?|fine gold|gold price|gold investment|buy gold|nuggets?|jewell?ery|necklaces?|bracelets?)\b|pexels\.com|unsplash\.com|shutterstock\.com|gettyimages\.com|istockphoto\.com|dreamstime\.com|depositphotos\.com|alamy\.com|123rf\.com|pixabay\.com|craiyon|midjourney|leonardo\.ai|nightcafe|starryai|\bdall-?e\b|stable diffusion|ideogram|getimg\.ai|lexica\.art|char-gen\.com|charsheet-gen|seaart\.ai|tensor\.art|novelai|mage\.space|\bdndai\b|ai generated|ai art|openai\.com|apmex|kitco|jmbullion/i;

const batches = new Map<string, { at: number; hits: GoogleCharacterHit[] }>();
let googleChain: Promise<unknown> = Promise.resolve();
let googleBlockedUntil = 0;

/** One Google search at a time, so a full codex does not get blocked. */
function enqueueGoogle<T>(work: () => Promise<T>): Promise<T> {
  const run = googleChain.then(work, work);
  googleChain = run.then(() => wait(800), () => wait(800));
  return run;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const COLOR_WORD = /^(gold|golden|silver|copper|bronze|brass|red|blue|green|black|white|purple|crimson|scarlet|amber)$/i;
const WEAK_WORD = /^(man|men|woman|women|male|female|boy|girl|person|people|lady|guy)$/i;

/** D&D character portraits. Google Images first, then the web index if Google refuses. */
export async function searchGoogleCharacters(subject: string): Promise<GoogleCharacterHit[]> {
  const term = subject.trim().replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').slice(0, 100);
  if (!term) return [];
  const key = term.toLowerCase();
  const cached = batches.get(key);
  if (cached && Date.now() - cached.at < 600_000) return cached.hits;

  const lookup = `${term} dnd`;
  let hits = await collectCharacters(lookup, term);
  if (hits.length === 0) {
    const narrower = characterLookup(term);
    if (narrower !== lookup) hits = await collectCharacters(narrower, term);
  }
  if (hits.length > 0) batches.set(key, { at: Date.now(), hits });
  if (batches.size > 40) {
    const oldest = batches.keys().next().value;
    if (oldest) batches.delete(oldest);
  }
  return hits;
}

const CHARACTER = /\b(characters?|portraits?|dnd|fantasy|dragonborn|elves|elf|dwarves|dwarf|orcs?|goblins?|tieflings?|halflings?|gnomes?|humans?|clerics?|wizards?|rogues?|paladins?|rangers?|fighters?|barbarians?|bards?|druids?|warlocks?|sorcerers?|monks?|blacksmiths?|knights?|thieves|thief)\b/i;

/** Race and job, without a leading colour, when the full phrase only found commodities. */
function characterLookup(term: string): string {
  const words = term.split(/\s+/).filter((word) => !COLOR_WORD.test(word) && !WEAK_WORD.test(word));
  const phrase = words.join(' ').trim();
  return phrase ? `${phrase} dnd character` : `${term} dnd character`;
}

/** Prefer pictures that name the search. Otherwise keep a D&D character picture. */
function takeCharacters(found: GoogleCharacterHit[], term: string): GoogleCharacterHit[] {
  const named = found.filter((hit) => mentionsSubject(`${hit.title} ${hit.pageUrl}`, term));
  if (named.length > 0) return named;
  return found.filter((hit) => CHARACTER.test(`${hit.title} ${hit.pageUrl}`));
}

async function collectCharacters(lookup: string, term: string): Promise<GoogleCharacterHit[]> {
  let found: GoogleCharacterHit[] = [];
  if (Date.now() >= googleBlockedUntil) {
    try {
      found = await enqueueGoogle(() => loadGoogle(lookup));
    } catch {
      found = [];
    }
  }
  const googleHits = takeCharacters(found, term);
  if (googleHits.length > 0) return googleHits;
  return takeCharacters(await searchWebCharacters(lookup), term);
}

/** A gold-bar listing does not name the character that was searched. */
const SUBJECT_STOP = new Set(['and', 'the', 'for', 'with', 'from', 'her', 'his', 'she', 'him', 'that', 'this']);

function mentionsSubject(blob: string, term: string): boolean {
  const words = term.toLowerCase().split(/[^a-z0-9-]+/).filter((word) => (
    word.length > 2 && !COLOR_WORD.test(word) && !WEAK_WORD.test(word) && !SUBJECT_STOP.has(word)
  ));
  const text = blob.toLowerCase();
  if (words.length === 0) return /\b(character|portrait|fantasy|dnd|dragonborn|elf|dwarf)\b/i.test(blob);
  return words.some((word) => text.includes(word));
}

/** Image results for a D&D portrait search. */
async function searchWebCharacters(query: string): Promise<GoogleCharacterHit[]> {
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
  const hits: GoogleCharacterHit[] = [];
  const seen = new Set<string>();
  for (const block of html.matchAll(/\bm="([^"]+)"/g)) {
    const hit = bingHit(block[1] ?? '');
    if (!hit || seen.has(hit.imageUrl)) continue;
    seen.add(hit.imageUrl);
    hits.push(hit);
    if (hits.length >= 12) break;
  }
  return hits;
}

function bingHit(encoded: string): GoogleCharacterHit | null {
  let row: BingImage;
  try {
    row = JSON.parse(encoded.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')) as BingImage;
  } catch {
    return null;
  }
  const imageUrl = row.murl ?? '';
  const pageUrl = row.purl ?? '';
  const title = (row.t ?? '').replace(/\s+/g, ' ').trim();
  const desc = (row.desc ?? '').replace(/\s+/g, ' ').trim();
  if (!imageUrl.startsWith('https://') || !pageUrl.startsWith('https://') || !title) return null;
  if (/\.svg(\?|$)/i.test(imageUrl)) return null;
  if (/instagram\.com|facebook\.com|tiktok\.com|flickr\.com/i.test(`${pageUrl} ${imageUrl}`)) return null;
  const blob = `${title} ${desc} ${pageUrl} ${imageUrl}`;
  if (SKIP.test(blob)) return null;
  const thumbUrl = row.turl?.startsWith('https://') ? row.turl : imageUrl;
  return {
    id: `web-${hash(imageUrl)}`,
    title,
    thumbUrl,
    imageUrl,
    pageUrl,
    source: 'Web',
    creator: hostName(pageUrl),
    license: 'See source page',
  };
}

function hash(value: string): string {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(31, h) + value.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

async function loadGoogle(query: string, attempt = 0): Promise<GoogleCharacterHit[]> {
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
      return loadGoogle(query, attempt + 1);
    }
    return [];
  }
  if (!res.ok) return [];
  const text = await res.text();
  const wrapped = JSON.parse(text.replace(/^\)\]\}'\s*/, '')) as { ischj?: { results?: string } };
  const rows = JSON.parse(wrapped.ischj?.results ?? '[]') as GoogleImage[];
  const hits: GoogleCharacterHit[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const hit = toHit(row);
    if (!hit || seen.has(hit.imageUrl)) continue;
    seen.add(hit.imageUrl);
    hits.push(hit);
  }
  return hits;
}

function toHit(row: GoogleImage): GoogleCharacterHit | null {
  const imageUrl = row.ou ?? '';
  const pageUrl = row.ru ?? '';
  const title = (row.pt ?? '').replace(/\s+/g, ' ').trim();
  if (!imageUrl.startsWith('https://') || !pageUrl.startsWith('https://') || !title) return null;
  if (/\.svg(\?|$)/i.test(imageUrl)) return null;
  if (/instagram\.com|facebook\.com|tiktok\.com|flickr\.com/i.test(`${pageUrl} ${imageUrl}`)) return null;
  const blob = `${title} ${pageUrl} ${imageUrl} ${row.isu ?? ''}`;
  if (SKIP.test(blob)) return null;
  const thumbUrl = row.tu?.startsWith('https://') ? row.tu : imageUrl;
  let hash = 0;
  for (let i = 0; i < imageUrl.length; i += 1) hash = (hash * 31 + imageUrl.charCodeAt(i)) >>> 0;
  return {
    id: `google-${hash.toString(36)}`,
    title,
    thumbUrl,
    imageUrl,
    pageUrl,
    source: 'Google Images',
    creator: (row.st ?? '').trim() || hostName(pageUrl),
    license: 'See source page',
  };
}

function hostName(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, '');
  } catch {
    return 'Google Images';
  }
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
  isu?: string;
}
