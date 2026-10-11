import { parseArtQuery, scoreText } from '@grimoire/shared';
import type { NpcPortrait } from './npcTypes';

export interface PortraitPage {
  portraits: NpcPortrait[];
  hasMore: boolean;
}

/** D&D character portraits from Google Images. */
export async function searchNpcPortraits(query: string, page: number): Promise<PortraitPage> {
  const term = query.trim();
  if (!term) return { portraits: [], hasMore: false };
  const parsed = parseArtQuery(term, 'character');
  const settled = await Promise.allSettled([
    searchPacks(term, page),
  ]);
  const groups: NpcPortrait[][] = [];
  let hasMore = false;
  let reached = 0;
  for (const result of settled) {
    if (result.status !== 'fulfilled') continue;
    reached += 1;
    groups.push(result.value.portraits);
    if (result.value.hasMore) hasMore = true;
  }
  if (reached === 0) throw new Error('Portrait libraries unreachable');
  const seen = new Set<string>();
  const portraits: NpcPortrait[] = [];
  const longest = Math.max(0, ...groups.map((group) => group.length));
  for (let i = 0; i < longest; i += 1) {
    for (const group of groups) {
      const portrait = group[i];
      if (!portrait || seen.has(portrait.imageUrl)) continue;
      seen.add(portrait.imageUrl);
      portraits.push(portrait);
    }
  }
  const fantasy = portraits.filter((portrait) => isCharacterPortrait(portrait) && mentionsSearch(portrait.title, term));
  fantasy.sort((a, b) => (
    scoreText(`${b.title} ${b.creator}`, parsed.keywords, parsed.words)
    - scoreText(`${a.title} ${a.creator}`, parsed.keywords, parsed.words)
  ));
  return { portraits: fantasy, hasMore };
}

const portraitJobs = new Map<string, Promise<NpcPortrait | null>>();
let portraitSlots = 0;
const portraitWaiters: Array<() => void> = [];

/** Words that must appear in the picture title for that job. */
const ROLE_TOKENS: Record<string, string[]> = {
  innkeeper: ['innkeeper', 'barkeep', 'tavern'],
  blacksmith: ['blacksmith', 'smith'],
  'guard captain': ['guard', 'captain'],
  scholar: ['scholar', 'wizard'],
  sellsword: ['mercenary', 'warrior', 'fighter'],
  merchant: ['merchant', 'trader'],
  'temple priest': ['priest', 'cleric'],
  thief: ['thief', 'rogue'],
  noble: ['noble', 'lord'],
  'grove warden': ['druid', 'ranger', 'warden'],
  herbalist: ['herbalist', 'healer'],
  'bounty hunter': ['bounty', 'hunter'],
  knight: ['knight'],
  barkeep: ['barkeep', 'bartender', 'innkeeper'],
  'ships mate': ['sailor', 'pirate'],
  'fortune teller': ['fortune', 'oracle', 'diviner'],
  mayor: ['mayor'],
  courier: ['courier', 'messenger'],
  hunter: ['hunter', 'ranger'],
  cleric: ['cleric', 'priest'],
  paladin: ['paladin', 'knight'],
  wizard: ['wizard', 'mage'],
  sorcerer: ['sorcerer', 'mage'],
  warlock: ['warlock'],
  druid: ['druid'],
  ranger: ['ranger', 'hunter'],
  rogue: ['rogue', 'thief'],
  bard: ['bard'],
  barbarian: ['barbarian', 'warrior'],
  fighter: ['fighter', 'warrior'],
  monk: ['monk'],
  artificer: ['artificer', 'artisan'],
  assassin: ['assassin', 'rogue'],
  necromancer: ['necromancer', 'wizard'],
  wanderer: ['wanderer', 'traveler'],
  'caravan master': ['caravan', 'merchant'],
  'shrine keeper': ['priest', 'cleric'],
  jeweler: ['jeweler', 'jeweller', 'artisan'],
  'mine foreman': ['miner', 'foreman'],
  gravedigger: ['gravedigger', 'grave', 'undertaker'],
};

const ANCESTRY_TOKEN = /^(dwarf|elf|orc|gnome|halfling|goblin|dragon|dragonborn|tiefling|half-elf|half-orc|kobold|tabaxi|aasimar|goliath)$/;
const JUNK = /\b(bad|hamster|lego|minecraft|pokemon|logo|diagram|map|flag|icon|sprites?|spritesheets?|sprite sheets?|chibi|pixel|8-?bit|16-?bit|tilesets?|rigged|model|photo|photograph|headshots?|businessman|stock photos?|cosplay|selfie|asset packs?|art packs?|rpg maker|chargen|lexica|craiyon|gold bars?|silver bars?|bullion|ingots?|gold coins?|silver coins?|krugerrand|karats?|fine gold|gold price|nuggets?|jewell?ery|necklaces?|bracelets?)\b/i;
const AI_HOST = /craiyon|lexica\.art|char-gen|charsheet-gen|midjourney|nightcafe|starryai|getimg\.ai|seaart|tensor\.art|novelai|mage\.space/i;
/** Painted D&D character art from Google Images. Sprite sheets and pack previews are not portraits. */
const FANTASY_ART = /^(google images|web)$/i;

function isCharacterPortrait(portrait: { title: string; imageUrl: string; source: string }): boolean {
  return FANTASY_ART.test(portrait.source)
    && !/\.svg(\?|$)/i.test(portrait.imageUrl)
    && !JUNK.test(portrait.title)
    && !AI_HOST.test(`${portrait.title} ${portrait.imageUrl}`);
}

const FEMALE_WORD = /\b(female|woman|women|girl|lady|lass|queen|dame)\b/i;
const MALE_WORD = /\b(male|man|men|boy|gentleman|lord)\b/i;

/** she/her or he/him in the writing, then a title such as Dame or Lord. */
export function characterGender(text: string, name = ''): 'female' | 'male' | '' {
  const female = /\b(she|her|hers|herself)\b/i.test(text);
  const male = /\b(he|him|his|himself)\b/i.test(text);
  if (female && !male) return 'female';
  if (male && !female) return 'male';
  if (/\b(dame|sister|lady|madam)\b/i.test(name)) return 'female';
  if (/\b(lord|sir)\b/i.test(name)) return 'male';
  return '';
}

const LOOK = /\b(gold|golden|silver|copper|bronze|brass|red|blue|green|black|white|purple|crimson|scarlet|hooded|cloaked)\b/i;

const QUERY_STOP = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'with', 'and', 'or', 'to', 'for', 'from', 'by', 'at',
]);
const COLOR_WORD = /^(gold|golden|silver|copper|bronze|brass|red|blue|green|black|white|purple|crimson|scarlet|amber)$/;
const WEAK_WORD = /^(man|men|woman|women|male|female|boy|girl|person|people|lady|guy)$/;

/** A colour or the word man is not enough. The title has to name the race or the job. */
function mentionsSearch(title: string, query: string): boolean {
  const words = query.toLowerCase().split(/[^a-z0-9-]+/).filter((word) => (
    word.length > 2 && !QUERY_STOP.has(word) && !COLOR_WORD.test(word) && !WEAK_WORD.test(word)
    && word !== 'dnd' && word !== 'fantasy' && word !== 'character' && word !== 'portrait'
  ));
  if (words.length === 0) return true;
  return words.some((word) => nameHas(title, word));
}

/** The picture search. A typed description is kept whole; catalog people use their written details. */
export function portraitSearchText(ancestry: string, role: string, appearance: string, name = '', prompt = ''): string {
  const typed = prompt.trim();
  if (typed) return typed;
  const gender = characterGender(appearance, name);
  const who = gender === 'female' ? 'woman' : gender === 'male' ? 'man' : '';
  const look = appearance.match(LOOK)?.[1] ?? '';
  const job = /^wanderer$/i.test(role) ? '' : role.trim();
  const gear = job ? '' : (appearance.match(/\b(cloak|hood|mask|robe|staff|bow)\b/i)?.[1] ?? '');
  const youth = /\b(child|young)\b/i.test(appearance) ? 'child' : '';
  return [who, youth, look, ancestry.trim(), job || gear].filter(Boolean).slice(0, 4).join(' ');
}

const RACES = ['half-elf', 'half-orc', 'dragonborn', 'dwarf', 'elf', 'orc', 'gnome', 'halfling', 'goblin', 'tiefling', 'dragon', 'kobold', 'tabaxi', 'aasimar', 'goliath'];

/** A D&D portrait that does not contradict this person. The search already asks for their details. */
export function portraitMatches(
  portrait: { title: string; imageUrl: string; source: string },
  ancestry: string,
  role: string,
  appearance = '',
  name = '',
): boolean {
  if (!isCharacterPortrait(portrait)) return false;
  if (/\b(ideas|stat blocks?|species|wiki|token set|miniature)\b/i.test(portrait.title)) return false;
  if (wrongGender(portrait.title, appearance, name)) return false;
  if (wrongAncestry(portrait.title, ancestry)) return false;
  return role.trim().length > 0 || ancestry.trim().length > 0;
}

/** One matching picture for a codex row. */
export function suggestNpcPortrait(
  id: string,
  ancestry: string,
  role: string,
  appearance = '',
  name = '',
  prompt = '',
): Promise<NpcPortrait | null> {
  const gender = characterGender(appearance, name);
  const typed = prompt.trim();
  const key = typed
    ? `words:${id}:${typed.toLowerCase()}`
    : `bing:${id}:${ancestry}:${role}:${gender}`;
  const existing = portraitJobs.get(key);
  if (existing) return existing;
  const job = (async () => {
    await takePortraitSlot();
    try {
      const queries = portraitQueries(ancestry, role, appearance, name, typed);
      const wanted = promptWords(typed);
      let loose: NpcPortrait | null = null;
      let looseScore = 0;
      for (const query of queries) {
        const packs = await searchPacks(query, 1);
        const ranked = packs.portraits
          .filter((hit) => portraitMatches(hit, ancestry, role, appearance, name))
          .sort((a, b) => pictureScore(b.title, ancestry, role, appearance, name, typed) - pictureScore(a.title, ancestry, role, appearance, name, typed));
        const fitted = ranked.find((hit) => {
          const score = pictureScore(hit.title, ancestry, role, appearance, name, typed);
          if (wanted.length > 0) return wanted.some((word) => nameHas(hit.title, word)) && score >= 6;
          return roleWords(role).some((word) => nameHas(hit.title, word)) && score >= 6;
        });
        if (fitted) return fitted;
        const top = ranked[0];
        if (!top) continue;
        const score = pictureScore(top.title, ancestry, role, appearance, name, typed);
        if (score >= 6 && score > looseScore) {
          loose = top;
          looseScore = score;
        }
      }
      return loose;
    } catch {
      return null;
    } finally {
      releasePortraitSlot();
    }
  })();
  portraitJobs.set(key, job);
  void job.then((portrait) => {
    if (!portrait) portraitJobs.delete(key);
  }, () => portraitJobs.delete(key));
  return job;
}

/** The written person, then a wider fantasy wording if that finds nobody. */
function portraitQueries(ancestry: string, role: string, appearance: string, name: string, prompt: string): string[] {
  const typed = prompt.trim();
  const primary = portraitSearchText(ancestry, role, appearance, name);
  const gender = characterGender(appearance, name);
  const who = gender === 'female' ? 'woman' : gender === 'male' ? 'man' : '';
  const race = ancestry.trim().toLowerCase() === 'human' ? '' : ancestry.trim();
  const job = roleWords(role)[0] ?? role.trim();
  const wider = [who, race, job, 'fantasy character'].filter(Boolean).join(' ');
  return [...new Set([typed, primary, wider].map((item) => item.trim()).filter(Boolean))];
}

function promptWords(prompt: string): string[] {
  const words: string[] = [];
  for (const word of prompt.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (word.length > 2 && !QUERY_STOP.has(word) && !words.includes(word)) words.push(word);
  }
  return words;
}

function wrongGender(title: string, appearance: string, name: string): boolean {
  const gender = characterGender(appearance, name);
  if (gender === 'female') return MALE_WORD.test(title) && !FEMALE_WORD.test(title);
  if (gender === 'male') return FEMALE_WORD.test(title) && !MALE_WORD.test(title);
  return false;
}

function wrongAncestry(title: string, ancestry: string): boolean {
  const mine = ancestry.trim().toLowerCase().replace(/half[\s-]+elf/g, 'half-elf').replace(/half[\s-]+orc/g, 'half-orc');
  const named = RACES.filter((race) => nameHas(title, race)).filter((race) => {
    if (race === 'elf' && nameHas(title, 'half-elf')) return false;
    if (race === 'orc' && nameHas(title, 'half-orc')) return false;
    if (race === 'dragon' && nameHas(title, 'dragonborn')) return false;
    return true;
  });
  if (named.length === 0) return false;
  if (mine === 'human') return true;
  return !named.includes(mine);
}

function roleWords(role: string): string[] {
  const roleKey = role.trim().toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ');
  const mapped = ROLE_TOKENS[roleKey];
  if (mapped && mapped.length > 0) return mapped;
  return roleKey.length > 3 ? [roleKey] : [];
}

function nameHas(title: string, token: string): boolean {
  const blob = ` ${title.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const word = token.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!word) return false;
  return blob.includes(` ${word} `) || blob.includes(` ${word}`);
}

function pictureScore(title: string, ancestry: string, role: string, appearance: string, name: string, prompt = ''): number {
  const ancestryWord = ancestry.trim().toLowerCase();
  let score = 1;
  if (/\bportrait\b/i.test(title)) score += 6;
  if (/\bcharacter\b/i.test(title)) score += 3;
  if (ANCESTRY_TOKEN.test(ancestryWord) && nameHas(title, ancestryWord)) score += 4;
  if (roleWords(role).some((word) => nameHas(title, word))) score += 8;
  const gender = characterGender(appearance, name);
  if (gender === 'female' && FEMALE_WORD.test(title)) score += 6;
  if (gender === 'male' && MALE_WORD.test(title)) score += 6;
  for (const word of promptWords(prompt)) {
    if (nameHas(title, word)) score += 5;
  }
  return score;
}

function takePortraitSlot(): Promise<void> {
  if (portraitSlots < 2) {
    portraitSlots += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => portraitWaiters.push(resolve));
}

function releasePortraitSlot() {
  const next = portraitWaiters.shift();
  if (next) next();
  else portraitSlots -= 1;
}

async function searchPacks(query: string, page: number): Promise<PortraitPage> {
  const params = new URLSearchParams({ q: query, page: String(page) });
  const res = await fetch(`/api/art/characters?${params}`, {
    credentials: 'include',
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Art ${res.status}`);
  const data = (await res.json()) as { portraits?: NpcPortrait[]; hasMore?: boolean };
  const portraits = (data.portraits ?? []).filter((portrait): portrait is NpcPortrait => (
    typeof portrait?.imageUrl === 'string' && portrait.imageUrl.startsWith('https://')
    && typeof portrait.thumbUrl === 'string' && portrait.thumbUrl.startsWith('https://')
    && typeof portrait.title === 'string'
    && typeof portrait.id === 'string'
    && typeof portrait.pageUrl === 'string'
    && typeof portrait.source === 'string'
    && typeof portrait.creator === 'string'
    && typeof portrait.license === 'string'
    && mentionsSearch(portrait.title, query)
  ));
  return { portraits, hasMore: Boolean(data.hasMore) };
}
