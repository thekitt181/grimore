import { SRD_ITEM_BUY_GP } from './constants/srdItemPrices';

/** DMG Magic Item Values — typical (midpoint of the listed range), in gp. */
const DMG_RARITY_BUY_GP: Record<string, number> = {
  common: 75,
  uncommon: 300,
  rare: 2500,
  'very rare': 25000,
  legendary: 125000,
};

export interface ItemPriceQuery {
  name?: string;
  type?: string;
  rarity?: string;
  description?: string;
  listedGp?: number | null;
}

export interface ItemMarketPrice {
  buyGp: number;
  sellGp: number;
  buyLabel: string;
  sellLabel: string;
  basis: 'listed' | 'srd' | 'rarity';
}

export function itemNameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/['’`]/g, '')
    .replace(/armor/g, 'armor')
    .replace(/armour/g, 'armor')
    .replace(/[^a-z0-9+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatGpAmount(gp: number): string {
  if (!Number.isFinite(gp) || gp <= 0) return '0 gp';
  let copper = Math.round(gp * 100);
  const gold = Math.floor(copper / 100);
  copper -= gold * 100;
  const sp = Math.floor(copper / 10);
  copper -= sp * 10;
  const parts: string[] = [];
  if (gold) parts.push(`${gold.toLocaleString('en-US')} gp`);
  if (sp) parts.push(`${sp} sp`);
  if (copper) parts.push(`${copper} cp`);
  return parts.join(' ') || '0 gp';
}

export function formatItemMarketLine(price: ItemMarketPrice): string {
  return `buy ${price.buyLabel} · sell ${price.sellLabel}`;
}

function coinUnitToGp(amount: number, unit: string): number {
  switch (unit.replace(/\s+/g, '').toLowerCase()) {
    case 'pp':
    case 'platinum':
      return amount * 10;
    case 'gp':
    case 'gold':
      return amount;
    case 'ep':
    case 'electrum':
      return amount * 0.5;
    case 'sp':
    case 'silver':
      return amount * 0.1;
    case 'cp':
    case 'copper':
      return amount * 0.01;
    default:
      return amount;
  }
}

export function parseListedGp(raw: unknown): number | undefined {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'string') {
    const m = raw.match(/([\d,.]+)\s*(pp|gp|ep|sp|cp|platinum|gold|electrum|silver|copper)?/i);
    if (!m) return undefined;
    const n = Number(m[1]!.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return coinUnitToGp(n, m[2] ?? 'gp');
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const n = Number(o['quantity'] ?? o['amount'] ?? o['value'] ?? o['cost']);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    const unit = String(o['unit'] ?? o['coin'] ?? 'gp');
    return coinUnitToGp(n, unit);
  }
  return undefined;
}

function parseCostFromDescription(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const m = text.match(/\bcost:\s*([\d,.]+)\s*(pp|gp|ep|sp|cp)?\b/i);
  if (!m) return undefined;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return coinUnitToGp(n, m[2] ?? 'gp');
}

function lookupSrd(name: string | undefined): number | undefined {
  if (!name) return undefined;
  const key = itemNameKey(name);
  if (!key) return undefined;
  if (/\+\s*[123]\b/.test(key)) return undefined;
  const direct = SRD_ITEM_BUY_GP[key];
  if (direct != null) return direct;
  const stripped = key
    .replace(/^(a|an|the)\s+/, '')
    .replace(/\b(bag of|set of|pair of|vial of|flask of)\s+/g, '')
    .replace(/\s+\d+$/, '');
  if (stripped !== key && SRD_ITEM_BUY_GP[stripped] != null) return SRD_ITEM_BUY_GP[stripped];
  const noArmor = stripped.replace(/\s+armor$/, '');
  if (noArmor !== stripped && SRD_ITEM_BUY_GP[noArmor] != null) return SRD_ITEM_BUY_GP[noArmor];
  return undefined;
}

function rarityKey(rarity: string | undefined): string | undefined {
  if (!rarity) return undefined;
  const k = rarity.toLowerCase().replace(/_/g, ' ').trim();
  if (k === 'very-rare' || k === 'veryrare') return 'very rare';
  if (k === 'none' || k === 'unknown' || k === 'varies' || k === 'standard' || k === 'mundane') {
    return undefined;
  }
  if (k in DMG_RARITY_BUY_GP) return k;
  return undefined;
}

function isConsumable(name: string | undefined, type: string | undefined): boolean {
  return /\b(potion|scroll|elixir|oil|dust|ammunition|arrow|bolt|needle|ration)\b/i.test(
    `${name ?? ''} ${type ?? ''}`,
  );
}

function finish(buyGp: number, basis: ItemMarketPrice['basis']): ItemMarketPrice {
  const sellGp = buyGp / 2;
  return {
    buyGp,
    sellGp,
    buyLabel: formatGpAmount(buyGp),
    sellLabel: formatGpAmount(sellGp),
    basis,
  };
}

/** PHB listed buy price; sell is half (PHB Adventuring Gear). Magic uses DMG rarity values. */
export function resolveItemMarketPrice(query: ItemPriceQuery): ItemMarketPrice | null {
  const listed = query.listedGp != null && query.listedGp > 0
    ? query.listedGp
    : parseCostFromDescription(query.description);
  if (listed != null && listed > 0) return finish(listed, 'listed');

  const srd = lookupSrd(query.name);
  if (srd != null) return finish(srd, 'srd');

  const rarity = rarityKey(query.rarity);
  if (rarity) {
    let buy = DMG_RARITY_BUY_GP[rarity]!;
    if (isConsumable(query.name, query.type)) buy = buy / 2;
    return finish(buy, 'rarity');
  }

  return null;
}
