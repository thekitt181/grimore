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

/** Real people, maps, idea boards, and generated pictures are not a D&D character. */
const SKIP = /\b(cosplays?|cosplayer|selfie|photograph|photoshoot|photo shoot|real life|\birl\b|actor|actress|celebrity|meme|screenshot|logo|battle ?map|dungeon map|world map|rulebook|dice set|sprites?|spritesheets?|chibi|pixel|8-?bit|16-?bit|tilesets?|asset packs?|art packs?|rpg maker|ideas)\b|craiyon|midjourney|leonardo\.ai|nightcafe|starryai|\bdall-?e\b|stable diffusion|ideogram|getimg\.ai|lexica\.art|char-gen\.com|charsheet-gen|seaart\.ai|tensor\.art|novelai|mage\.space|ai generated|ai art|openai\.com/i;

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

/** D&D character portraits. Web image results first, because Google often refuses a full codex. */
export async function searchGoogleCharacters(subject: string): Promise<GoogleCharacterHit[]> {
  const term = subject.trim().replace(/[^\w\s'-]/g, ' ').replace(/\s+/g, ' ').slice(0, 100);
  if (!term) return [];
  const key = term.toLowerCase();
  const cached = batches.get(key);
  if (cached && Date.now() - cached.at < 600_000) return cached.hits;

  let hits = await searchWebCharacters(`${term} dnd character art`);
  if (hits.length === 0 && Date.now() >= googleBlockedUntil) {
    try {
      hits = await enqueueGoogle(() => loadGoogle(`${term} dnd character portrait -cosplay -cosplayer -sprite -pixel`));
    } catch {
      hits = [];
    }
  }
  batches.set(key, { at: Date.now(), hits });
  if (batches.size > 40) {
    const oldest = batches.keys().next().value;
    if (oldest) batches.delete(oldest);
  }
  return hits;
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
  if (!imageUrl.startsWith('https://') || !pageUrl.startsWith('https://') || !title) return null;
  if (/\.svg(\?|$)/i.test(imageUrl)) return null;
  if (/instagram\.com|facebook\.com|tiktok\.com|flickr\.com/i.test(`${pageUrl} ${imageUrl}`)) return null;
  if (SKIP.test(`${title} ${pageUrl} ${imageUrl}`)) return null;
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
}

interface GoogleImage {
  ou?: string;
  ru?: string;
  tu?: string;
  pt?: string;
  st?: string;
  isu?: string;
}
