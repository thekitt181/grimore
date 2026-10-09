import type { CompendiumItem } from '@grimoire/shared';
import { isLikelyValidItem } from '@grimoire/monster-dex';
import { detectItemRarity, type LootRarity } from './lootRoll';

export interface ShopLine {
  name: string;
  cost: string;
  note?: string;
  id?: string;
}

export interface ShopStock {
  shop: string;
  kind: string;
  staples: ShopLine[];
  visit: ShopLine[];
}

interface Staple {
  name: string;
  gp: number;
}

interface ShopKind {
  id: string;
  label: string;
  match: RegExp;
  keywords: string[];
  /** Extra weight for these rarities. Missing rarities stay available at weight 1. */
  rarityBias: Partial<Record<LootRarity | 'mundane', number>>;
  priceScale: number;
  staples: Staple[];
}

const BANDS: Record<LootRarity, [number, number]> = {
  common: [50, 100],
  uncommon: [101, 500],
  rare: [501, 5000],
  'very rare': [5001, 50000],
  legendary: [50001, 200000],
  artifact: [200001, 500000],
};

const UNIVERSAL: Staple[] = [
  { name: 'Rations (1 day)', gp: 0.5 },
  { name: 'Torch', gp: 0.01 },
  { name: 'Tinderbox', gp: 0.5 },
  { name: 'Hempen rope (50 feet)', gp: 1 },
  { name: 'Waterskin', gp: 0.2 },
  { name: 'Sack', gp: 0.01 },
];

const KINDS: ShopKind[] = [
  {
    id: 'black-market',
    label: 'Black market',
    match: /black\s*market|underworld|smuggler|contraband/,
    keywords: ['poison', 'thieves', 'dagger', 'disguise', 'curse', 'venom'],
    rarityBias: { uncommon: 2, rare: 4, 'very rare': 3, legendary: 2 },
    priceScale: 1.75,
    staples: [
      { name: "Thieves' tools", gp: 25 },
      { name: 'Disguise kit', gp: 25 },
      { name: 'Poisoner\'s kit', gp: 50 },
      { name: 'Vial of basic poison', gp: 100 },
    ],
  },
  {
    id: 'thieves',
    label: 'Thieves\' fence',
    match: /thief|thieves|fence|burglar|rogue|stolen/,
    keywords: ['thieves', 'dagger', 'cloak', 'poison', 'lock'],
    rarityBias: { mundane: 3, common: 3, uncommon: 3, rare: 2 },
    priceScale: 0.6,
    staples: [
      { name: "Thieves' tools", gp: 25 },
      { name: 'Crowbar', gp: 2 },
      { name: 'Grappling hook', gp: 2 },
      { name: 'Caltrops (20)', gp: 1 },
      { name: 'Hooded lantern', gp: 5 },
    ],
  },
  {
    id: 'cursed',
    label: 'Cursed seller',
    match: /cursed|curse|hex|hag|unlucky/,
    keywords: ['cursed', 'curse', 'hex', 'doom', 'bane'],
    rarityBias: { common: 2, uncommon: 3, rare: 3, 'very rare': 2, legendary: 1 },
    priceScale: 1.25,
    staples: [
      { name: 'Unidentified trinket', gp: 25 },
      { name: 'Charm of doubtful make', gp: 40 },
      { name: 'Black candle', gp: 1 },
      { name: 'Sealed jar of ash', gp: 5 },
    ],
  },
  {
    id: 'blacksmith',
    label: 'Blacksmith',
    match: /blacksmith|smith|armou?rer|weapon|forge/,
    keywords: ['sword', 'axe', 'armor', 'armour', 'shield', 'mace', 'hammer', 'dagger', 'spear'],
    rarityBias: { mundane: 4, common: 3, uncommon: 2, rare: 1 },
    priceScale: 1,
    staples: [
      { name: 'Dagger', gp: 2 },
      { name: 'Handaxe', gp: 5 },
      { name: 'Spear', gp: 1 },
      { name: 'Shortsword', gp: 10 },
      { name: 'Longsword', gp: 15 },
      { name: 'Shield', gp: 10 },
      { name: 'Leather armor', gp: 10 },
      { name: 'Chain shirt', gp: 50 },
    ],
  },
  {
    id: 'alchemist',
    label: 'Alchemist',
    match: /alchem|apothecary|potion|herbal/,
    keywords: ['potion', 'vial', 'acid', 'alchem', 'herb', 'antitoxin'],
    rarityBias: { common: 4, uncommon: 3, rare: 2, mundane: 2 },
    priceScale: 1,
    staples: [
      { name: 'Potion of healing', gp: 50 },
      { name: 'Antitoxin', gp: 50 },
      { name: 'Vial of acid', gp: 25 },
      { name: 'Alchemist\'s fire', gp: 50 },
      { name: 'Healer\'s kit', gp: 5 },
      { name: 'Vial', gp: 1 },
    ],
  },
  {
    id: 'magic',
    label: 'Magic shop',
    match: /magic|arcane|wizard|enchanter|scroll|mage/,
    keywords: ['wand', 'staff', 'scroll', 'ring', 'robe', 'spell', 'crystal'],
    rarityBias: { common: 2, uncommon: 4, rare: 4, 'very rare': 2, legendary: 1, mundane: 0.4 },
    priceScale: 1,
    staples: [
      { name: 'Component pouch', gp: 25 },
      { name: 'Arcane focus (crystal)', gp: 10 },
      { name: 'Ink (1 ounce)', gp: 10 },
      { name: 'Parchment (one sheet)', gp: 0.1 },
      { name: 'Spellbook (blank)', gp: 50 },
    ],
  },
  {
    id: 'temple',
    label: 'Temple',
    match: /temple|shrine|church|priest|chapel/,
    keywords: ['holy', 'sacred', 'symbol', 'relic', 'mace', 'prayer'],
    rarityBias: { mundane: 2, common: 3, uncommon: 3, rare: 2 },
    priceScale: 1,
    staples: [
      { name: 'Holy water (flask)', gp: 25 },
      { name: 'Holy symbol', gp: 5 },
      { name: 'Healer\'s kit', gp: 5 },
      { name: 'Block of incense', gp: 0.01 },
      { name: 'Potion of healing', gp: 50 },
    ],
  },
  {
    id: 'fletcher',
    label: 'Fletcher',
    match: /fletcher|bowyer|bow\b|arrow/,
    keywords: ['bow', 'arrow', 'crossbow', 'bolt', 'quiver'],
    rarityBias: { mundane: 4, common: 3, uncommon: 2 },
    priceScale: 1,
    staples: [
      { name: 'Arrows (20)', gp: 1 },
      { name: 'Bolts (20)', gp: 1 },
      { name: 'Shortbow', gp: 25 },
      { name: 'Longbow', gp: 50 },
      { name: 'Light crossbow', gp: 25 },
      { name: 'Quiver', gp: 1 },
    ],
  },
  {
    id: 'jeweler',
    label: 'Jeweler',
    match: /jewel|gem|goldsmith/,
    keywords: ['gem', 'jewel', 'ring', 'necklace', 'crown', 'pearl', 'diamond'],
    rarityBias: { mundane: 2, common: 2, uncommon: 3, rare: 3, 'very rare': 1 },
    priceScale: 1.1,
    staples: [
      { name: 'Gold ring', gp: 25 },
      { name: 'Silver necklace', gp: 15 },
      { name: 'Small pearl', gp: 100 },
    ],
  },
  {
    id: 'scribe',
    label: 'Scribe',
    match: /scribe|bookshop|bookseller|library|stationer/,
    keywords: ['scroll', 'book', 'tome', 'ink', 'map', 'spell'],
    rarityBias: { mundane: 3, common: 3, uncommon: 3, rare: 2 },
    priceScale: 1,
    staples: [
      { name: 'Book', gp: 25 },
      { name: 'Ink (1 ounce)', gp: 10 },
      { name: 'Ink pen', gp: 0.02 },
      { name: 'Parchment (one sheet)', gp: 0.1 },
      { name: 'Map case', gp: 1 },
    ],
  },
  {
    id: 'tailor',
    label: 'Tailor',
    match: /tailor|clothier|haberdasher|seamstress/,
    keywords: ['robe', 'cloak', 'clothes', 'boots', 'hat', 'glove'],
    rarityBias: { mundane: 4, common: 3, uncommon: 2 },
    priceScale: 1,
    staples: [
      { name: 'Common clothes', gp: 0.5 },
      { name: 'Traveler\'s clothes', gp: 2 },
      { name: 'Fine clothes', gp: 15 },
      { name: 'Robes', gp: 1 },
      { name: 'Costume', gp: 5 },
    ],
  },
  {
    id: 'stable',
    label: 'Stable',
    match: /stable|ostler|horse|farrier/,
    keywords: ['saddle', 'bit', 'bridle', 'feed', 'horse'],
    rarityBias: { mundane: 5, common: 2 },
    priceScale: 1,
    staples: [
      { name: 'Riding saddle', gp: 10 },
      { name: 'Bit and bridle', gp: 2 },
      { name: 'Saddlebags', gp: 4 },
      { name: 'Feed (1 day)', gp: 0.05 },
    ],
  },
  {
    id: 'tavern',
    label: 'Tavern',
    match: /tavern|inn\b|alehouse|pub\b/,
    keywords: ['ale', 'wine', 'ration', 'mug', 'meal'],
    rarityBias: { mundane: 5, common: 2, uncommon: 1 },
    priceScale: 1,
    staples: [
      { name: 'Mug of ale', gp: 0.04 },
      { name: 'Common wine (pitcher)', gp: 0.2 },
      { name: 'Modest meal', gp: 0.3 },
      { name: 'Comfortable meal', gp: 0.5 },
      { name: 'Inn room (night)', gp: 0.5 },
    ],
  },
  {
    id: 'general',
    label: 'General store',
    match: /general|merchant|trader|provision|shop|store|market/,
    keywords: ['ration', 'rope', 'lantern', 'tool', 'pack', 'cloak'],
    rarityBias: { mundane: 4, common: 3, uncommon: 2, rare: 1 },
    priceScale: 1,
    staples: [
      { name: 'Backpack', gp: 2 },
      { name: 'Bedroll', gp: 1 },
      { name: 'Blanket', gp: 0.5 },
      { name: 'Hooded lantern', gp: 5 },
      { name: 'Flask of oil', gp: 0.1 },
      { name: 'Piton', gp: 0.05 },
    ],
  },
];

function rollInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function formatCost(gp: number): string {
  const amount = Math.max(0.01, gp);
  if (amount >= 1) return `${Math.round(amount).toLocaleString('en-US')} gp`;
  if (amount >= 0.1) return `${Math.max(1, Math.round(amount * 10))} sp`;
  return `${Math.max(1, Math.round(amount * 100))} cp`;
}

function isShopItem(item: CompendiumItem): boolean {
  if (!isLikelyValidItem(item)) return false;
  const name = item.name.trim();
  if (name.length > 60 || /[\n\r]/.test(name)) return false;
  if ((item.type ?? '').length > 80) return false;
  const description = item.description ?? '';
  if (description.length > 3000 && /items by rarity|introduction:/i.test(description)) return false;
  return true;
}

function matchesWords(item: CompendiumItem, words: string[]): boolean {
  if (words.length === 0) return false;
  const blob = `${item.name} ${item.type}`.toLowerCase();
  return words.some((word) => new RegExp(`\\b${word}\\b`).test(blob));
}

function resolveKind(shopName: string): ShopKind {
  const text = shopName.toLowerCase();
  for (const kind of KINDS) {
    if (kind.match.test(text)) return kind;
  }
  const words = text.split(/[^a-z0-9]+/).filter((word) => word.length > 3).slice(0, 6);
  const label = shopName.trim().slice(0, 40) || 'General store';
  return {
    id: 'custom',
    label,
    match: /$^/,
    keywords: words,
    rarityBias: { mundane: 3, common: 3, uncommon: 2, rare: 2, 'very rare': 1 },
    priceScale: 1,
    staples: [
      { name: `House specialty from ${label}`, gp: 10 },
      { name: 'Canvas-wrapped trade goods', gp: 5 },
    ],
  };
}

function itemWeight(item: CompendiumItem, kind: ShopKind): number {
  const rarity = detectItemRarity(item);
  const key = rarity ?? 'mundane';
  const bias = kind.rarityBias[key] ?? 1;
  const cursed = kind.id === 'cursed' && /\b(cursed|curse|hex)\b/i.test(`${item.name} ${item.type}`);
  const themed = matchesWords(item, kind.keywords);
  return bias * (cursed ? 8 : 1) * (themed ? 6 : 1);
}

function drawWeighted(pool: Array<{ item: CompendiumItem; weight: number }>, count: number): CompendiumItem[] {
  const working = pool.filter((entry) => entry.weight > 0);
  const picked: CompendiumItem[] = [];
  while (picked.length < count && working.length > 0) {
    const total = working.reduce((sum, entry) => sum + entry.weight, 0);
    let roll = Math.random() * total;
    let index = working.length - 1;
    for (let i = 0; i < working.length; i += 1) {
      roll -= working[i]!.weight;
      if (roll <= 0) {
        index = i;
        break;
      }
    }
    const [chosen] = working.splice(index, 1);
    if (chosen) picked.push(chosen.item);
  }
  return picked;
}

function pickVisit(items: CompendiumItem[], kind: ShopKind, count: number): CompendiumItem[] {
  const valid = items.filter(isShopItem);
  const themed = valid.filter((item) => (
    matchesWords(item, kind.keywords)
    || (kind.id === 'cursed' && /\b(cursed|curse|hex)\b/i.test(`${item.name} ${item.type}`))
  ));
  const first = drawWeighted(themed.map((item) => ({ item, weight: itemWeight(item, kind) })), count);
  if (first.length >= count) return first;
  const used = new Set(first.map((item) => item.id));
  const rest = drawWeighted(
    valid.filter((item) => !used.has(item.id)).map((item) => ({ item, weight: itemWeight(item, kind) })),
    count - first.length,
  );
  return [...first, ...rest];
}

function priceItem(item: CompendiumItem, scale: number): number {
  const rarity = detectItemRarity(item);
  if (/^potion of healing$/i.test(item.name.trim())) return 50 * scale;
  if (!rarity) return rollInt(2, 30) * scale;
  const [min, max] = BANDS[rarity];
  const rolled = rollInt(min, max);
  const consumable = /\b(potion|scroll|elixir|oil|dust)\b/i.test(`${item.name} ${item.type}`);
  return Math.max(1, (consumable ? Math.round(rolled / 2) : rolled) * scale);
}

function stapleLine(staple: Staple, scale: number): ShopLine {
  return { name: staple.name, cost: formatCost(staple.gp * scale), note: 'Always' };
}

export function rollShopStock(items: CompendiumItem[], shopName: string): ShopStock {
  const typed = shopName.trim().slice(0, 80);
  const kind = resolveKind(typed || 'General store');
  const staples = [...UNIVERSAL, ...kind.staples].map((staple) => stapleLine(staple, kind.priceScale));
  const visit = pickVisit(items, kind, 20).map((item) => {
    const rarity = detectItemRarity(item);
    return {
      id: item.id,
      name: item.name,
      cost: formatCost(priceItem(item, kind.priceScale)),
      ...(rarity ? { note: rarity } : { note: item.type || 'Goods' }),
    };
  });
  return {
    shop: typed || kind.label,
    kind: kind.label,
    staples,
    visit,
  };
}
