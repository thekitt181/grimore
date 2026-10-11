const STOP = new Set([
  'a', 'an', 'the', 'in', 'on', 'of', 'with', 'and', 'or', 'to', 'for', 'from', 'by', 'at',
  'near', 'inside', 'outside', 'under', 'through', 'across', 'around', 'into', 'over', 'onto',
  'off', 'out', 'up', 'down', 'their', 'there', 'they', 'them', 'his', 'her', 'its', 'who',
  'that', 'this', 'covering', 'covered', 'cover', 'wearing', 'wears', 'wore', 'wear',
  'while', 'where', 'when', 'some', 'very', 'just', 'like',
]);

const EXPAND: Record<string, string[]> = {
  rouge: ['rogue', 'thief'],
  rogue: ['rogue', 'thief'],
  thief: ['thief', 'rogue'],
  assassin: ['assassin', 'rogue'],
  warrior: ['warrior', 'fighter'],
  fighter: ['fighter', 'warrior'],
  mage: ['mage', 'wizard'],
  wizard: ['wizard', 'mage'],
  woman: ['woman', 'female'],
  female: ['woman', 'female'],
  man: ['man', 'male'],
  male: ['man', 'male'],
  girl: ['girl', 'child', 'young'],
  boy: ['boy', 'child', 'young'],
  child: ['child', 'young'],
  kid: ['child', 'young'],
  'half-elf': ['half-elf', 'elf'],
  'half-orc': ['half-orc', 'orc'],
};

const MAP_ALIAS: Record<string, string> = {
  inn: 'tavern',
  pub: 'tavern',
  bar: 'tavern',
  cellar: 'dungeon',
  basement: 'dungeon',
  crypt: 'dungeon',
  catacomb: 'dungeon',
  tomb: 'dungeon',
  cavern: 'cave',
  caverns: 'cave',
  mine: 'cave',
  mines: 'cave',
  woods: 'forest',
  jungle: 'forest',
  street: 'town',
  streets: 'town',
  graveyard: 'crypt',
  cemetery: 'crypt',
  keep: 'castle',
  fortress: 'castle',
  swamp: 'marsh',
  bog: 'marsh',
  ruins: 'ruin',
  ruined: 'ruin',
};

const ANCESTRY = /^(goblin|orc|elf|dwarf|human|halfling|gnome|dragon|kobold|ogre|troll|skeleton|zombie|vampire|wolf|tiefling|tabaxi|kenku|hobgoblin|bugbear|gnoll|half-elf|half-orc|owlbear|beholder)$/;

const PLACE = new Set([
  'tavern', 'dungeon', 'cave', 'crypt', 'castle', 'forest', 'road', 'town', 'village',
  'sewer', 'temple', 'ship', 'camp', 'marsh', 'mountain', 'tower', 'ruin', 'bridge',
  'desert', 'city', 'alley', 'manor', 'lake', 'river', 'coast', 'island', 'arena',
  'prison', 'library', 'market', 'warehouse', 'barn', 'farm', 'house', 'interior',
  'hall', 'corridor', 'chamber', 'palace', 'cathedral', 'church', 'shrine', 'harbor',
  'dock', 'volcano', 'ice', 'snow', 'gate', 'wall', 'clearing', 'throne', 'pit',
]);

export interface ArtQuery {
  /** User words plus spellings and synonyms, for ranking. */
  keywords: string[];
  /** Words to search with, typos and map names folded, no synonym stuffing. */
  words: string[];
  /** Short phrase for a site that requires every word. */
  detailed: string;
  /** Phrase for photo libraries. Short character searches name the subject as a character. */
  image: string;
  /** Wider phrases to try when the detailed one matches nothing. */
  broader: string[];
}

export function characterKeywords(query: string): string[] {
  return parseArtQuery(query, 'character').keywords;
}

export function parseArtQuery(raw: string, kind: 'character' | 'map'): ArtQuery {
  const normalized = raw
    .toLowerCase()
    .replace(/half[\s-]+elf/g, 'half-elf')
    .replace(/half[\s-]+orc/g, 'half-orc')
    .replace(/\brouge\b/g, 'rogue');
  const tokens = normalized.split(/[^a-z0-9-]+/).filter((word) => word.length > 2 && !STOP.has(word));
  const words: string[] = [];
  const keywords: string[] = [];
  for (const token of tokens) {
    const canonical = kind === 'map' && MAP_ALIAS[token] ? MAP_ALIAS[token] : token;
    push(words, canonical);
    push(keywords, canonical);
    push(keywords, token);
    if (kind === 'character') {
      for (const extra of EXPAND[canonical] ?? []) push(keywords, extra);
    }
  }
  const ordered = kind === 'map' ? placeFirst(words) : words;
  const detailed = (kind === 'map' ? ordered.slice(0, 2) : ordered.slice(0, 4)).join(' ');
  const image = imagePhrase(detailed, ordered, kind);
  const broader = wider(ordered, detailed, kind);
  const fallback = raw.trim();
  return {
    keywords,
    words: ordered,
    detailed: detailed || fallback,
    image: image || fallback,
    broader,
  };
}

/** Higher when the text mentions more of the description. Focus words count extra. */
export function scoreText(text: string, keywords: string[], focus: string[] = []): number {
  const blob = ` ${text.toLowerCase().replace(/[^a-z0-9-]+/g, ' ').replace(/\s+/g, ' ')} `;
  const hit = (word: string) => {
    if (blob.includes(` ${word} `) || blob.includes(`-${word}`) || blob.includes(`${word}-`)) return true;
    if (word.length < 4) return false;
    return blob.includes(` ${word}`) || blob.includes(`-${word}`);
  };
  let score = 0;
  for (const word of keywords) {
    if (word && hit(word)) score += 1;
  }
  for (const word of focus) {
    if (word && hit(word)) score += 2;
  }
  return score;
}

function imagePhrase(detailed: string, words: string[], kind: 'character' | 'map'): string {
  if (!detailed) return '';
  if (kind === 'map') return detailed;
  if (words.length > 0 && words.length <= 2) return `fantasy ${detailed} character`;
  return detailed;
}

function wider(words: string[], detailed: string, kind: 'character' | 'map'): string[] {
  const out: string[] = [];
  if (kind === 'map') {
    for (const place of words.filter((word) => PLACE.has(word)).slice(0, 2)) push(out, place);
    if (out.length === 0 && words[0]) push(out, words[0]);
    return out.filter((phrase) => phrase !== detailed).slice(0, 2);
  }
  const subject = words.find((word) => ANCESTRY.test(word)) ?? words[0] ?? '';
  if (words.length > 2) push(out, words.slice(0, 2).join(' '));
  for (const word of words) {
    const alt = (EXPAND[word] ?? []).find((extra) => extra !== word);
    if (!alt) continue;
    push(out, subject && subject !== word ? `${subject} ${alt}` : alt);
  }
  if (subject) push(out, subject);
  return out.filter((phrase) => phrase && phrase !== detailed).slice(0, 3);
}

function placeFirst(words: string[]): string[] {
  const places = words.filter((word) => PLACE.has(word));
  if (places.length === 0) return words;
  return [...places, ...words.filter((word) => !PLACE.has(word))];
}

function push(list: string[], word: string) {
  if (word && !list.includes(word)) list.push(word);
}
