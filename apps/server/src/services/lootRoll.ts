import type { CompendiumItem } from '@grimoire/shared';
import { isLikelyValidItem } from '@grimoire/monster-dex';

export type LootRarity = 'common' | 'uncommon' | 'rare' | 'very rare' | 'legendary' | 'artifact';

export interface LootCurrencyDrop {
  kind: 'currency';
  label: string;
}

export interface LootItemDrop {
  kind: 'item';
  id: string;
  name: string;
  type: string;
  rarity?: string;
  source?: string;
  /** Original catalog name when this is a reflavored D&D item. */
  reflavoredFrom?: string;
}

export interface LootFlavorDrop {
  kind: 'flavor';
  name: string;
  detail: string;
}

export type LootDrop = LootCurrencyDrop | LootItemDrop | LootFlavorDrop;

export interface LootRollResult {
  partyLevel: number | null;
  tier: string;
  source: string;
  count: number;
  drops: LootDrop[];
}

interface TierPool {
  rarity: LootRarity | null;
  weight: number;
}

interface LootTier {
  label: string;
  pools: TierPool[];
  gpMin: number;
  gpMax: number;
}

interface LootSource {
  id: string;
  label: string;
  keywords: string[];
  flavor: string[];
  flavorChance: number;
  coinChance: number;
  gpScale: number;
  coinPrefix: string;
}

const RARITY_ORDER: LootRarity[] = ['artifact', 'legendary', 'very rare', 'rare', 'uncommon', 'common'];

const SOURCES: LootSource[] = [
  {
    id: 'skeleton',
    label: 'Skeleton',
    keywords: ['bone', 'skull', 'necrotic', 'undead', 'shroud', 'burial', 'skeleton'],
    flavor: ['Cracked rib', 'Finger bone', 'Tattered burial shroud', 'Rusted burial nail', 'Moth-eaten cloak scrap', 'Loose tooth in a jaw', 'Frayed prayer strip', 'Bent iron buckle'],
    flavorChance: 0.55,
    coinChance: 0.25,
    gpScale: 0.35,
    coinPrefix: 'Tarnished burial coins',
  },
  {
    id: 'zombie',
    label: 'Zombie',
    keywords: ['rotten', 'grave', 'zombie', 'ghoul'],
    flavor: ['Torn shirt', 'Grave dirt', 'Broken belt', 'Sour rag', 'Splintered fingernail', 'Mud-caked boot', 'Chewed coin', 'Loose button'],
    flavorChance: 0.6,
    coinChance: 0.18,
    gpScale: 0.25,
    coinPrefix: 'Coins in a rotten pocket',
  },
  {
    id: 'goblin',
    label: 'Goblin',
    keywords: ['goblin', 'kobold', 'sling', 'bomb'],
    flavor: ['Shiny button', 'Bent spoon', 'Bag of teeth', 'Crude shiv', 'Glass bead', 'Stolen boot', 'Dirty rag with a doodle', 'Half-eaten sausage'],
    flavorChance: 0.55,
    coinChance: 0.25,
    gpScale: 0.4,
    coinPrefix: 'Goblin stash',
  },
  {
    id: 'bandit',
    label: 'Bandit',
    keywords: ['bandit', 'thieves', 'poison', 'crossbow'],
    flavor: ['Worn dice', 'Cheap flask', 'Frayed coin purse', 'Notched knife', 'Tin cup', 'Greasy playing cards', 'Wanted scrap', 'Boot knife'],
    flavorChance: 0.38,
    coinChance: 0.4,
    gpScale: 0.8,
    coinPrefix: 'Stolen purse',
  },
  {
    id: 'orc',
    label: 'Orc',
    keywords: ['orc', 'greataxe', 'javelin', 'tusk'],
    flavor: ['Broken tusk', 'Bloodied rag', 'Crude charm', 'Notched axe chip', 'Leather thong', 'Iron nose ring', 'Charred meat', 'War paint pot'],
    flavorChance: 0.42,
    coinChance: 0.28,
    gpScale: 0.7,
    coinPrefix: 'Orc belt pouch',
  },
  {
    id: 'cultist',
    label: 'Cultist',
    keywords: ['cult', 'scroll', 'robe', 'candle', 'symbol'],
    flavor: ['Black candle stub', 'Torn page of rites', 'Chalk sigil', 'Hood scrap', 'Bone bead', 'Sealed vial of ash', 'Red thread', 'Small iron symbol'],
    flavorChance: 0.48,
    coinChance: 0.22,
    gpScale: 0.6,
    coinPrefix: 'Offering coins',
  },
  {
    id: 'chest',
    label: 'Chest',
    keywords: ['potion', 'gem', 'jewel', 'scroll', 'key', 'wand', 'ring', 'map'],
    flavor: ['Iron key', 'Wax-sealed letter', 'Spare padlock', 'Folded cloth', 'Dusty bottle', 'Brass hinge', 'Coiled twine', 'Loose glass gem'],
    flavorChance: 0.3,
    coinChance: 0.42,
    gpScale: 1.4,
    coinPrefix: 'Coins from the chest',
  },
  {
    id: 'dragon-hoard',
    label: 'Dragon hoard',
    keywords: ['gem', 'jewel', 'crown', 'chalice', 'necklace', 'diamond', 'ruby', 'sapphire', 'pearl', 'gold'],
    flavor: ['Scorched coin', 'Melted crown', 'Eye-sized gem', 'Charred banner', 'Dented gold cup', 'Blackened pearl', 'Scale-scratched shield boss', 'Heat-warped ring'],
    flavorChance: 0.24,
    coinChance: 0.52,
    gpScale: 4,
    coinPrefix: 'Hoard coins',
  },
  {
    id: 'dragon',
    label: 'Dragon',
    keywords: ['dragon', 'scale', 'claw', 'fang', 'wyrm'],
    flavor: ['Loose scale', 'Broken claw', 'Warm gem', 'Scrap of a rider’s cloak', 'Scorched coin stuck in a tooth', 'Shed horn tip', 'Ash-caked pebble of gold'],
    flavorChance: 0.45,
    coinChance: 0.3,
    gpScale: 2.2,
    coinPrefix: 'Scorched coins',
  },
  {
    id: 'delerium',
    label: 'Delerium',
    keywords: ['delerium', 'delirium', 'dererium', 'crystal', 'shard', 'prism', 'warped', 'alien', 'purple'],
    flavor: [
      'Humming delerium shard',
      'Fractured delerium crystal',
      'Vial of delerium dust',
      'Warped purple delerium splinter',
      'Glow-veined delerium chip',
      'Cracked delerium geode',
      'Delerium-tainted scale',
      'Prismatic delerium needle',
      'Sealed delerium fragment',
      'Alien crystal of delerium',
    ],
    flavorChance: 0.4,
    coinChance: 0.22,
    gpScale: 2,
    coinPrefix: 'Strange crystal-trade coins',
  },
  {
    id: 'ruby',
    label: 'Ruby',
    keywords: ['ruby', 'crimson', 'garnet', 'bloodstone'],
    flavor: ['Chipped ruby', 'Crimson cabochon', 'Blood-red glass bead', 'Garnet chip'],
    flavorChance: 0.35,
    coinChance: 0.28,
    gpScale: 1.8,
    coinPrefix: 'Ruby-stained coins',
  },
  {
    id: 'emerald',
    label: 'Emerald',
    keywords: ['emerald', 'jade', 'malachite'],
    flavor: ['Emerald flake', 'Jade bead', 'Green glass cabochon', 'Malachite chip'],
    flavorChance: 0.35,
    coinChance: 0.28,
    gpScale: 1.8,
    coinPrefix: 'Green-gem coins',
  },
  {
    id: 'topaz',
    label: 'Topaz',
    keywords: ['topaz', 'topex', 'citrine', 'amber'],
    flavor: ['Topaz chip', 'Amber bead', 'Honey-gold crystal', 'Citrine splinter'],
    flavorChance: 0.35,
    coinChance: 0.28,
    gpScale: 1.6,
    coinPrefix: 'Topaz-trade coins',
  },
  {
    id: 'sapphire',
    label: 'Sapphire',
    keywords: ['sapphire', 'azure', 'lapis'],
    flavor: ['Sapphire chip', 'Azure bead', 'Lapis shard'],
    flavorChance: 0.35,
    coinChance: 0.28,
    gpScale: 1.8,
    coinPrefix: 'Sapphire-trade coins',
  },
  {
    id: 'diamond',
    label: 'Diamond',
    keywords: ['diamond', 'adamant'],
    flavor: ['Diamond dust pinch', 'Clear crystal chip', 'Adamant flake'],
    flavorChance: 0.3,
    coinChance: 0.32,
    gpScale: 2.4,
    coinPrefix: 'Diamond-trade coins',
  },
  {
    id: 'gold',
    label: 'Gold',
    keywords: ['gold', 'golden', 'gilded', 'aurum'],
    flavor: ['Gold nugget', 'Gilded scale', 'Bent gold ring', 'Gold thread'],
    flavorChance: 0.28,
    coinChance: 0.45,
    gpScale: 2,
    coinPrefix: 'Gold coins',
  },
  {
    id: 'fire',
    label: 'Fire',
    keywords: ['fire', 'flame', 'flaming', 'inferno', 'magma', 'lava', 'burning', 'scorched', 'ember'],
    flavor: ['Cooling ember', 'Scorched scale', 'Cinder in a vial', 'Heat-warped coin', 'Charcoal charm'],
    flavorChance: 0.42,
    coinChance: 0.22,
    gpScale: 1.3,
    coinPrefix: 'Heat-warped coins',
  },
  {
    id: 'ice',
    label: 'Ice',
    keywords: ['ice', 'frost', 'frozen', 'cold', 'winter', 'glacial', 'rime'],
    flavor: ['Rime crystal', 'Frosted scale', 'Never-melt ice chip', 'Cold-iron nail', 'Snow-glass bead'],
    flavorChance: 0.42,
    coinChance: 0.22,
    gpScale: 1.3,
    coinPrefix: 'Frost-rimed coins',
  },
  {
    id: 'lightning',
    label: 'Lightning',
    keywords: ['lightning', 'storm', 'thunder', 'shocking', 'spark'],
    flavor: ['Static-charged scale', 'Storm-glass bead', 'Scorched copper wire', 'Thunderstone chip'],
    flavorChance: 0.4,
    coinChance: 0.22,
    gpScale: 1.3,
    coinPrefix: 'Storm-pitted coins',
  },
  {
    id: 'beast',
    label: 'Beast',
    keywords: ['hide', 'pelt', 'fang', 'claw', 'fur'],
    flavor: ['Tuft of fur', 'Broken fang', 'Claw tip', 'Nest scrap', 'Gnawed bone', 'Shed scale', 'Feather', 'Strip of hide'],
    flavorChance: 0.7,
    coinChance: 0.08,
    gpScale: 0.15,
    coinPrefix: 'Coins in the den',
  },
  {
    id: 'mimic',
    label: 'Mimic',
    keywords: ['mimic', 'adhesive'],
    flavor: ['Sticky coin', 'Tongue-scarred lid splinter', 'Half-dissolved gem', 'Buckle from a previous meal', 'Warped key', 'Pseudopod slime'],
    flavorChance: 0.5,
    coinChance: 0.28,
    gpScale: 1,
    coinPrefix: 'Coins stuck to the mimic',
  },
  {
    id: 'corpse',
    label: 'Corpse',
    keywords: ['locket', 'signet', 'letter'],
    flavor: ['Bloodstained letter', 'Signet still on a finger', 'Torn map', 'Empty flask', 'Family locket', 'Boot with a hidden slit', 'Folded handkerchief'],
    flavorChance: 0.45,
    coinChance: 0.3,
    gpScale: 0.7,
    coinPrefix: 'Coins on the body',
  },
];

const ANY_SOURCE: LootSource = {
  id: 'any',
  label: 'Anything',
  keywords: [],
  flavor: ['Odd trinket', 'Folded scrap', 'Loose bead', 'Worn token', 'Small pouch', 'Chipped figurine', 'Length of cord', 'Unmarked vial'],
  flavorChance: 0.34,
  coinChance: 0.33,
  gpScale: 1,
  coinPrefix: 'Coins',
};

const ANY_TIER: LootTier = {
  label: 'Any',
  gpMin: 8,
  gpMax: 400,
  pools: [
    { rarity: null, weight: 3 },
    { rarity: 'common', weight: 4 },
    { rarity: 'uncommon', weight: 3 },
    { rarity: 'rare', weight: 2 },
    { rarity: 'very rare', weight: 1 },
    { rarity: 'legendary', weight: 1 },
  ],
};

function tierForLevel(level: number): LootTier {
  if (level <= 4) {
    return {
      label: '1–4',
      gpMin: 6,
      gpMax: 40,
      pools: [
        { rarity: null, weight: 2 },
        { rarity: 'common', weight: 3 },
        { rarity: 'uncommon', weight: 1 },
      ],
    };
  }
  if (level <= 10) {
    return {
      label: '5–10',
      gpMin: 40,
      gpMax: 280,
      pools: [
        { rarity: 'uncommon', weight: 2 },
        { rarity: 'rare', weight: 1 },
      ],
    };
  }
  if (level <= 16) {
    return {
      label: '11–16',
      gpMin: 180,
      gpMax: 1600,
      pools: [
        { rarity: 'rare', weight: 3 },
        { rarity: 'very rare', weight: 2 },
      ],
    };
  }
  return {
    label: '17–20',
    gpMin: 800,
    gpMax: 6000,
    pools: [
      { rarity: 'very rare', weight: 5 },
      { rarity: 'legendary', weight: 3 },
      { rarity: 'artifact', weight: 1 },
    ],
  };
}

function rollInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export function detectItemRarity(item: { rarity?: string; type?: string }): LootRarity | null {
  const blob = `${item.rarity ?? ''} ${item.type ?? ''}`.toLowerCase();
  for (const rarity of RARITY_ORDER) {
    if (new RegExp(`\\b${rarity}\\b`).test(blob)) return rarity;
  }
  return null;
}

function isLootCandidate(item: CompendiumItem): boolean {
  if (!isLikelyValidItem(item)) return false;
  const name = item.name.trim();
  if (name.length > 60 || /[\n\r]/.test(name)) return false;
  if ((item.type ?? '').length > 80) return false;
  const description = item.description ?? '';
  if (description.length > 3000 && /items by rarity|introduction:/i.test(description)) return false;
  return true;
}

function pickIndex<T>(list: T[]): T | undefined {
  if (list.length === 0) return undefined;
  return list[rollInt(0, list.length - 1)];
}

function pickWeighted<T extends { weight: number }>(list: T[]): T | undefined {
  const total = list.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let roll = Math.random() * total;
  for (const entry of list) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return list[list.length - 1];
}

function sourceById(id: string): LootSource {
  return SOURCES.find((source) => source.id === id) ?? ANY_SOURCE;
}

const SOURCE_ALIASES: Array<[RegExp, string]> = [
  [/hoard/, 'dragon-hoard'],
  [/\b(dragon|wyrm|drake)s?\b/, 'dragon'],
  [/skeleton|skeletal/, 'skeleton'],
  [/zombie|ghoul|wight/, 'zombie'],
  [/ghost|spectre|specter|wraith|banshee/, 'corpse'],
  [/goblin|kobold/, 'goblin'],
  [/bandit|thug|brigand|highwayman|robber|pirate/, 'bandit'],
  [/\borc\b|hobgoblin/, 'orc'],
  [/cult|acolyte|priest/, 'cultist'],
  [/chest|coffer|trunk|crate|strongbox/, 'chest'],
  [/mimic/, 'mimic'],
  [/wolf|bear|beast|spider|rat|boar|owlbear|hydra/, 'beast'],
  [/corpse|body|remains|cadaver/, 'corpse'],
  [/\b(delerium|delirium|dererium)\b/, 'delerium'],
  [/\brub(y|ies)\b/, 'ruby'],
  [/\bemeralds?\b/, 'emerald'],
  [/\b(topaz|topex|citrine)\b/, 'topaz'],
  [/\bsapphires?\b/, 'sapphire'],
  [/\bdiamonds?\b/, 'diamond'],
  [/\bgold(en|ed)?\b|\bgilded\b/, 'gold'],
  [/\b(fire|flame|flaming|inferno|magma|lava|ember)s?\b/, 'fire'],
  [/\b(ice|frost|frozen|glacial|rime|winter)\b/, 'ice'],
  [/\b(lightning|thunder|storm|shocking)\b/, 'lightning'],
];

const MOTIF_SOURCE_IDS = new Set([
  'delerium', 'ruby', 'emerald', 'topaz', 'sapphire', 'diamond', 'gold',
  'fire', 'ice', 'lightning',
]);

function isMotifSource(source: LootSource): boolean {
  return MOTIF_SOURCE_IDS.has(source.id);
}

function capitalizeWord(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

function motifScraps(parts: LootSource[], extras: string[]): string[] {
  const labels = [
    ...parts.filter(isMotifSource).map((part) => part.label),
    ...extras.map(capitalizeWord),
  ];
  const scraps = labels.flatMap((label) => {
    const lower = label.toLowerCase();
    return [
      `${label} shard`,
      `Fractured ${lower} crystal`,
      `Vial of ${lower} dust`,
      `Glow-veined ${lower} chip`,
      `Raw ${lower} fragment`,
      `${label}-tainted scale`,
      `Humming ${lower} geode`,
      `Sealed ${lower} splinter`,
    ];
  });
  return [...scraps, ...parts.filter(isMotifSource).flatMap((part) => part.flavor)];
}

const NAME_STOPWORDS = new Set([
  'ancient', 'adult', 'young', 'wyrmling', 'greater', 'lesser', 'huge', 'large',
  'medium', 'small', 'tiny', 'giant', 'the', 'and', 'from', 'with', 'that',
  'this', 'into', 'over', 'under', 'very', 'named', 'type', 'kind', 'elder',
]);

function sourcesFromText(name: string): LootSource[] {
  const text = name.toLowerCase();
  if (!text.trim()) return [];
  const found: LootSource[] = [];
  const seen = new Set<string>();
  for (const [pattern, id] of SOURCE_ALIASES) {
    if (!pattern.test(text) || seen.has(id)) continue;
    seen.add(id);
    const source = sourceById(id);
    if (source.id !== 'any') found.push(source);
  }
  return found;
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !NAME_STOPWORDS.has(word));
}

function leftoverKeywords(name: string, already: string[]): string[] {
  const used = new Set(already.map((word) => word.toLowerCase()));
  return nameTokens(name).filter((word) => !used.has(word));
}

function mergeSources(parts: LootSource[], extraKeywords: string[] = []): LootSource {
  if (parts.length === 0) return ANY_SOURCE;
  const keywords = [...new Set([...parts.flatMap((part) => part.keywords), ...extraKeywords])];
  if (parts.length === 1 && extraKeywords.length === 0) return parts[0]!;
  const labels = [...new Set([
    ...parts.map((part) => part.label),
    ...extraKeywords.map((word) => word[0]!.toUpperCase() + word.slice(1)),
  ])];
  const richest = parts.reduce((best, part) => (part.gpScale > best.gpScale ? part : best), parts[0]!);
  return {
    id: parts.map((part) => part.id).join('+'),
    label: labels.join(' + '),
    keywords,
    flavor: parts.flatMap((part) => part.flavor),
    flavorChance: parts.reduce((sum, part) => sum + part.flavorChance, 0) / parts.length,
    coinChance: parts.reduce((sum, part) => sum + part.coinChance, 0) / parts.length,
    gpScale: richest.gpScale,
    coinPrefix: richest.coinPrefix,
  };
}

function subjectSource(subjectName: string): LootSource {
  const words = leftoverKeywords(subjectName, []);
  const label = subjectName.trim().slice(0, 40) || 'This';
  return {
    id: 'this',
    label: words.length > 0 ? words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(' + ') : label,
    keywords: words,
    flavor: [
      `Scrap from the ${label}`,
      `Something the ${label} was carrying`,
      `A belonging of the ${label}`,
      `Torn gear from the ${label}`,
      `A pouch off the ${label}`,
      `A token marked by the ${label}`,
      `A note found on the ${label}`,
      `A charm taken from the ${label}`,
    ],
    flavorChance: 0.18,
    coinChance: 0.22,
    gpScale: 1,
    coinPrefix: `Coins from the ${label}`,
  };
}

function resolveSourceParts(sourceId: string, subjectName: string): LootSource[] {
  const selected = sourceId === 'this' || sourceId === 'any' || !sourceId
    ? []
    : SOURCES.find((source) => source.id === sourceId)
      ? [sourceById(sourceId)]
      : sourcesFromText(sourceId);
  const fromName = sourcesFromText(subjectName);
  const seen = new Set<string>();
  const parts: LootSource[] = [];
  for (const source of [...selected, ...fromName]) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    parts.push(source);
  }
  return parts;
}

function resolveSource(sourceId: string, subjectName: string): LootSource {
  const parts = resolveSourceParts(sourceId, subjectName);
  const extras = leftoverKeywords(
    subjectName || sourceId,
    parts.flatMap((part) => part.keywords),
  );
  if (parts.length > 0) return mergeSources(parts, extras);
  if (sourceId === 'any' && !subjectName.trim()) return ANY_SOURCE;
  return subjectSource(subjectName || sourceId);
}

function formatCoins(gpValue: number, level: number | null, prefix: string): string {
  let copper = Math.max(100, Math.round(gpValue * 100));
  const parts: string[] = [];
  const rich = level == null ? gpValue >= 200 : level >= 11;
  const small = level == null ? gpValue < 30 : level <= 4;
  if (rich) {
    const ppAvailable = Math.floor(copper / 1000);
    const take = Math.floor(ppAvailable * (0.35 + Math.random() * 0.45));
    if (take > 0) {
      parts.push(`${take} pp`);
      copper -= take * 1000;
    }
  }
  const gp = Math.floor(copper / 100);
  if (gp > 0) {
    parts.push(`${gp} gp`);
    copper -= gp * 100;
  }
  if (small) {
    const sp = Math.floor(copper / 10);
    if (sp > 0) parts.push(`${sp} sp`);
    copper -= sp * 10;
    if (copper > 0) parts.push(`${copper} cp`);
  }
  const coins = parts.length > 0 ? parts.join(', ') : '1 gp';
  return `${prefix}: ${coins}`;
}

function rarityForTier(tier: LootTier): LootRarity | undefined {
  const named = tier.pools.map((pool) => pool.rarity).filter((rarity): rarity is LootRarity => rarity != null);
  return named.length > 0 ? pickIndex(named) : undefined;
}

function toItemDrop(item: CompendiumItem, nameOverride?: string): LootItemDrop {
  const rarity = item.rarity?.trim() || detectItemRarity(item) || undefined;
  const name = nameOverride?.trim() || item.name;
  return {
    kind: 'item',
    id: item.id,
    name,
    type: item.type,
    ...(rarity ? { rarity } : {}),
    ...(item.source ? { source: item.source } : {}),
    ...(name !== item.name ? { reflavoredFrom: item.name } : {}),
  };
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GEAR_RE = /armor|armour|weapon|wondrous|ring|staff|wand|rod|shield|mail|cloak|boots|helm|gauntlet|amulet|belt|plate|leather|scale mail|sword|axe|bow|mace|hammer|spear/i;

function isGearItem(item: CompendiumItem): boolean {
  return GEAR_RE.test(`${item.name} ${item.type}`);
}

function reflavorItemName(name: string, motif: string, identity: string[]): string {
  const motifName = capitalizeWord(motif.trim());
  if (!motifName || !name.trim()) return name;
  const tokens = [...new Set(identity.map((word) => word.toLowerCase()).filter((word) => word.length >= 3))]
    .sort((a, b) => b.length - a.length);
  let next = name;
  const phrases: Array<[RegExp, string]> = [
    [/\bdragon scale (?:mail|armou?r)\b/gi, `${motifName} Armor`],
    [/\bdragon scale\b/gi, motifName],
  ];
  for (const token of tokens) {
    phrases.push([new RegExp(`\\b${escapeRe(token)} scale (?:mail|armou?r)\\b`, 'gi'), `${motifName} Armor`]);
    phrases.push([new RegExp(`\\b${escapeRe(token)}s?\\b`, 'gi'), motifName]);
  }
  for (const [pattern, replacement] of phrases) {
    next = next.replace(pattern, replacement);
  }
  next = next.replace(new RegExp(`\\b(${escapeRe(motifName)})(?:\\s+\\1)+\\b`, 'gi'), '$1');
  next = next.replace(/\s+/g, ' ').trim();
  if (!next || next.toLowerCase() === name.toLowerCase()) {
    if (new RegExp(`\\b${escapeRe(motifName)}\\b`, 'i').test(name)) return name;
    next = `${motifName} ${name}`;
  }
  return next;
}

function fitsRarity(item: CompendiumItem, tier: LootTier): boolean {
  const rarity = detectItemRarity(item);
  return tier.pools.some((pool) => (pool.rarity == null ? rarity == null : rarity === pool.rarity));
}

function keywordVariants(word: string): string[] {
  const w = word.toLowerCase();
  const out = [w];
  if (w.endsWith('ies') && w.length > 4) out.push(`${w.slice(0, -3)}y`);
  else if (w.endsWith('ses') && w.length > 4) out.push(w.slice(0, -2));
  else if (w.endsWith('s') && !w.endsWith('ss') && w.length > 3) out.push(w.slice(0, -1));
  return [...new Set(out)];
}

function wordIn(text: string, variant: string): boolean {
  try {
    return new RegExp(`\\b${variant}\\b`).test(text);
  } catch {
    return text.includes(variant);
  }
}

function themeScore(item: CompendiumItem, keywords: string[]): number {
  if (keywords.length === 0) return 0;
  const name = item.name.toLowerCase();
  const type = item.type.toLowerCase();
  const desc = (item.description ?? '').toLowerCase().slice(0, 900);
  let score = 0;
  for (const word of keywords) {
    for (const variant of keywordVariants(word)) {
      if (wordIn(name, variant)) score += 8;
      else if (wordIn(type, variant)) score += 4;
      else if (wordIn(desc, variant)) score += 1;
    }
  }
  return score;
}

function pickBestThemedItem(
  candidates: CompendiumItem[],
  keywords: string[],
  used: Set<string>,
  tier: LootTier | null,
  minScore: number,
): CompendiumItem | null {
  if (keywords.length === 0) return null;
  const available = candidates.filter((item) => !used.has(item.id) && (tier == null || fitsRarity(item, tier)));
  const scored = available
    .map((item) => ({ item, score: themeScore(item, keywords) }))
    .filter((row) => row.score >= minScore);
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(4, Math.ceil(scored.length * 0.35)));
  const chosen = pickWeighted(top.map((row) => ({ weight: row.score, item: row.item })));
  return chosen?.item ?? top[0]!.item;
}

function pickUnthemedItem(
  candidates: CompendiumItem[],
  tier: LootTier,
  used: Set<string>,
): CompendiumItem | null {
  const available = candidates.filter((item) => !used.has(item.id) && fitsRarity(item, tier));
  const pools = tier.pools
    .map((pool) => ({
      weight: pool.weight,
      items: available.filter((item) => (
        pool.rarity == null ? detectItemRarity(item) == null : detectItemRarity(item) === pool.rarity
      )),
    }))
    .filter((pool) => pool.items.length > 0);
  const chosen = pickWeighted(pools);
  return chosen ? pickIndex(chosen.items) ?? null : null;
}

export function rollLootFromItems(
  items: CompendiumItem[],
  partyLevel: number | null,
  minCount: number,
  maxCount: number,
  sourceId = 'any',
  subjectName = '',
): LootRollResult {
  const level = partyLevel == null ? null : Math.min(20, Math.max(1, Math.floor(partyLevel)));
  const low = Math.min(20, Math.max(1, Math.floor(Math.min(minCount, maxCount))));
  const high = Math.min(20, Math.max(low, Math.floor(Math.max(minCount, maxCount))));
  const tier = level == null ? ANY_TIER : tierForLevel(level);
  const sourceParts = resolveSourceParts(sourceId, subjectName);
  const extras = leftoverKeywords(
    subjectName || (sourceId === 'this' || sourceId === 'any' ? '' : sourceId),
    sourceParts.flatMap((part) => part.keywords),
  );
  const source = sourceParts.length > 0
    ? mergeSources(sourceParts, extras)
    : resolveSource(sourceId, subjectName);
  const motifParts = sourceParts.filter(isMotifSource);
  const creatureParts = sourceParts.filter((part) => !isMotifSource(part));
  const motifKeywords = [...motifParts.flatMap((part) => part.keywords), ...extras];
  const creatureKeywords = creatureParts.flatMap((part) => part.keywords);
  const count = rollInt(low, high);
  const candidates = items.filter(isLootCandidate);
  const used = new Set<string>();
  const usedFlavor = new Set<string>();
  const drops: LootDrop[] = [];
  const from = subjectName.trim() || source.label;
  const motifFlavor = motifScraps(motifParts, extras);
  const allFlavor = motifFlavor.length > 0
    ? [...motifFlavor, ...creatureParts.flatMap((part) => part.flavor)]
    : source.flavor;

  let themeSeq = 0;
  const pushFlavor = (preferMotif: boolean) => {
    const pool = preferMotif && motifFlavor.length > 0 ? motifFlavor : allFlavor;
    const fresh = pool.filter((name) => !usedFlavor.has(name));
    const name = pickIndex(fresh.length > 0 ? fresh : pool);
    if (!name) return false;
    usedFlavor.add(name);
    drops.push({ kind: 'flavor', name, detail: `Taken from ${from}.` });
    return true;
  };

  const pushThemeItem = () => {
    const pool = motifFlavor.length > 0 ? motifFlavor : allFlavor;
    const fresh = pool.filter((name) => !usedFlavor.has(name));
    const name = pickIndex(fresh.length > 0 ? fresh : pool);
    if (!name) return false;
    usedFlavor.add(name);
    themeSeq += 1;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    const rarity = rarityForTier(tier);
    drops.push({
      kind: 'item',
      id: `loot-theme-${slug || 'scrap'}-${themeSeq}`,
      name,
      type: 'Treasure',
      ...(rarity ? { rarity } : {}),
      source: 'Loot',
    });
    return true;
  };

  const tryMotifItem = () => (
    pickBestThemedItem(candidates, motifKeywords, used, tier, 4)
    ?? pickBestThemedItem(candidates, motifKeywords, used, null, 4)
    ?? pickBestThemedItem(candidates, motifKeywords, used, null, 2)
  );

  const tryCreatureItem = () => (
    pickBestThemedItem(candidates, creatureKeywords, used, tier, 4)
    ?? pickBestThemedItem(candidates, creatureKeywords, used, tier, 1)
  );

  const motifLabel = (motifParts[0]?.label || extras[0] || '').trim();
  const skipIdentity = new Set(['claw', 'fang', 'hide', 'pelt', 'fur', 'bone', 'skull', 'gem', 'jewel']);
  const identityWords = [
    ...creatureParts.map((part) => part.label),
    ...creatureParts.map((part) => part.id),
    ...creatureKeywords,
  ].filter((word) => word.length >= 3 && !skipIdentity.has(word.toLowerCase()));

  const tryReflavorItem = (): CompendiumItem | null => {
    const gear = candidates.filter((item) => isGearItem(item));
    const pool = gear.length > 0 ? gear : candidates;
    return pickBestThemedItem(pool, creatureKeywords.length > 0 ? creatureKeywords : ['armor', 'mail', 'weapon', 'sword', 'shield', 'ring', 'cloak'], used, tier, 1)
      ?? pickBestThemedItem(pool, ['armor', 'mail', 'weapon', 'sword', 'shield'], used, null, 1)
      ?? pickUnthemedItem(pool, tier, used);
  };

  const pushItem = (item: CompendiumItem | null, reflavor = false) => {
    if (!item) return false;
    used.add(item.id);
    const name = reflavor && motifLabel ? reflavorItemName(item.name, motifLabel, identityWords) : item.name;
    drops.push(toItemDrop(item, name));
    return true;
  };

  const itemChance = Math.max(0.12, 1 - source.flavorChance - source.coinChance);
  const hasMotif = motifKeywords.length > 0;

  for (let i = 0; i < count; i += 1) {
    const roll = Math.random();
    if (hasMotif) {
      const forceCatalog = count >= 2 && i === 0;
      const forceThemeItem = count >= 2 && i === 1;
      if (forceCatalog) {
        if (pushItem(tryReflavorItem(), true) || pushItem(tryMotifItem()) || pushThemeItem()) continue;
      } else if (forceThemeItem) {
        if (pushItem(tryMotifItem()) || pushThemeItem()) continue;
      } else if (roll < 0.36) {
        if (pushItem(tryReflavorItem(), true) || pushItem(tryMotifItem())) continue;
      } else if (roll < 0.54) {
        if (pushItem(tryMotifItem()) || pushThemeItem()) continue;
      } else if (roll < 0.7) {
        if (pushThemeItem()) continue;
      } else if (roll < 0.84) {
        if (pushFlavor(true)) continue;
      } else if (roll < 0.93) {
        if (pushItem(tryCreatureItem(), true) || pushThemeItem()) continue;
      }
    } else if (roll < source.flavorChance) {
      if (pushFlavor(false)) continue;
    } else if (roll < source.flavorChance + itemChance) {
      const item = pickBestThemedItem(candidates, source.keywords, used, tier, 1)
        ?? (source.id === 'this' ? pickUnthemedItem(candidates, tier, used) : null);
      if (pushItem(item) || (source.keywords.length > 0 && source.id !== 'this' && pushFlavor(false))) continue;
    }
    const gp = Math.max(1, Math.round(rollInt(tier.gpMin, tier.gpMax) * source.gpScale));
    const coinPrefix = motifParts[0]?.coinPrefix ?? source.coinPrefix;
    drops.push({ kind: 'currency', label: formatCoins(gp, level, coinPrefix) });
  }

  return {
    partyLevel: level,
    tier: tier.label,
    source: source.label,
    count,
    drops,
  };
}
