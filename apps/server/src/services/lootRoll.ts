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
  [/dragon|wyrm|drake/, 'dragon'],
  [/skeleton|skeletal/, 'skeleton'],
  [/zombie|ghoul|wight/, 'zombie'],
  [/ghost|spectre|specter|wraith|banshee/, 'corpse'],
  [/goblin|kobold/, 'goblin'],
  [/bandit|thug|brigand|highwayman|robber|pirate/, 'bandit'],
  [/\borc\b|hobgoblin/, 'orc'],
  [/cult|acolyte|priest/, 'cultist'],
  [/chest|coffer|trunk|crate|strongbox/, 'chest'],
  [/mimic/, 'mimic'],
  [/wolf|bear|beast|spider|rat|boar|owlbear|hydra|beast/, 'beast'],
  [/corpse|body|remains|cadaver/, 'corpse'],
];

function knownSourceFromName(name: string): LootSource | null {
  const text = name.toLowerCase();
  for (const [pattern, id] of SOURCE_ALIASES) {
    if (pattern.test(text)) return sourceById(id);
  }
  return null;
}

function subjectSource(subjectName: string): LootSource {
  const known = knownSourceFromName(subjectName);
  if (known) return known;
  const words = subjectName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 3)
    .slice(0, 6);
  const label = subjectName.trim().slice(0, 40) || 'This';
  return {
    id: 'this',
    label,
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

function resolveSource(sourceId: string, subjectName: string): LootSource {
  if (sourceId === 'this' || sourceId === 'any') {
    return knownSourceFromName(subjectName) ?? (sourceId === 'this' ? subjectSource(subjectName) : ANY_SOURCE);
  }
  return sourceById(sourceId);
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

function toItemDrop(item: CompendiumItem): LootItemDrop {
  const rarity = item.rarity?.trim() || detectItemRarity(item) || undefined;
  return {
    kind: 'item',
    id: item.id,
    name: item.name,
    type: item.type,
    ...(rarity ? { rarity } : {}),
    ...(item.source ? { source: item.source } : {}),
  };
}

function fitsRarity(item: CompendiumItem, tier: LootTier): boolean {
  const rarity = detectItemRarity(item);
  return tier.pools.some((pool) => (pool.rarity == null ? rarity == null : rarity === pool.rarity));
}

function matchesKeywords(item: CompendiumItem, keywords: string[]): boolean {
  if (keywords.length === 0) return false;
  const blob = `${item.name} ${item.type}`.toLowerCase();
  return keywords.some((word) => new RegExp(`\\b${word}\\b`).test(blob));
}

function pickThemedItem(
  candidates: CompendiumItem[],
  tier: LootTier,
  keywords: string[],
  used: Set<string>,
): CompendiumItem | null {
  const available = candidates.filter((item) => !used.has(item.id) && fitsRarity(item, tier));
  if (keywords.length > 0) {
    return pickIndex(available.filter((item) => matchesKeywords(item, keywords))) ?? null;
  }
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
  const source = resolveSource(sourceId, subjectName);
  const count = rollInt(low, high);
  const candidates = items.filter(isLootCandidate);
  const used = new Set<string>();
  const usedFlavor = new Set<string>();
  const drops: LootDrop[] = [];
  const itemChance = Math.max(0.12, 1 - source.flavorChance - source.coinChance);

  for (let i = 0; i < count; i += 1) {
    const roll = Math.random();
    const from = subjectName.trim() || source.label;
    const pushFlavor = () => {
      const fresh = source.flavor.filter((name) => !usedFlavor.has(name));
      const name = pickIndex(fresh.length > 0 ? fresh : source.flavor);
      if (!name) return false;
      usedFlavor.add(name);
      drops.push({ kind: 'flavor', name, detail: `Taken from ${from}.` });
      return true;
    };
    if (roll < source.flavorChance) {
      if (pushFlavor()) continue;
    } else if (roll < source.flavorChance + itemChance) {
      let item = pickThemedItem(candidates, tier, source.keywords, used);
      if (!item && source.id === 'this') {
        item = pickThemedItem(candidates, tier, [], used);
      }
      if (item) {
        used.add(item.id);
        drops.push(toItemDrop(item));
        continue;
      }
      if (source.keywords.length > 0 && source.id !== 'this' && pushFlavor()) continue;
    }
    const gp = Math.max(1, Math.round(rollInt(tier.gpMin, tier.gpMax) * source.gpScale));
    drops.push({ kind: 'currency', label: formatCoins(gp, level, source.coinPrefix) });
  }

  return {
    partyLevel: level,
    tier: tier.label,
    source: source.label,
    count,
    drops,
  };
}
