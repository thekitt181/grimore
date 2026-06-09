import type { OwlbearMonster } from '@grimoire/shared';

export type CompendiumImageKind = 'monster' | 'item' | 'spell';

export function compendiumImageKey(kind: CompendiumImageKind, name: string): string {
  const prefix = kind === 'item' ? 'item_image_' : kind === 'spell' ? 'spell_image_' : 'monster_image_';
  return `${prefix}${name}`;
}

export function compendiumStaticImagePath(key: string): string {
  return `/api/compendium/static-image?key=${encodeURIComponent(key)}`;
}

/** Static-image route on the Owlbear extension server (port 3000). */
export function owlbearStaticImagePath(key: string): string {
  return `/api/static-image?key=${encodeURIComponent(key)}`;
}

function extractStaticKeyFromUrl(url: string): string | null {
  const match = url.match(/[?&]key=([^&]+)/);
  return match ? decodeURIComponent(match[1]!) : null;
}

/** Normalize image refs for shared Mongo so the Owlbear extension can resolve them. */
export function toOwlbearMongoImageRef(url: string): string {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:image')) return url;
  if (url.includes('static-image')) {
    const key = extractStaticKeyFromUrl(url);
    if (key) return owlbearStaticImagePath(key);
  }
  if (url.startsWith('/api/compendium/asset/')) {
    const rel = decodeURIComponent(url.slice('/api/compendium/asset/'.length));
    return rel.startsWith('/') ? rel : `/${rel}`;
  }
  if (url.startsWith('/images/') || url.startsWith('images/')) {
    return `/${url.replace(/^\/+/, '')}`;
  }
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith('/api/static-image')) return url;
  return url;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'entry';
}

export function parseCr(cr: string | number | undefined): number {
  if (cr === undefined || cr === null || cr === '') return 0;
  if (typeof cr === 'number') return cr;
  const s = String(cr).trim();
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (b && a !== undefined) return a / b;
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export function parseSizeFromType(type: string): string {
  const m = type.match(/^(Tiny|Small|Medium|Large|Huge|Gargantuan)\b/i);
  return m ? m[1]! : 'Medium';
}

export function monsterSizeToCells(size: string): number {
  switch (size) {
    case 'Tiny': return 0.5;
    case 'Small':
    case 'Medium': return 1;
    case 'Large': return 2;
    case 'Huge': return 3;
    case 'Gargantuan': return 4;
    default: return 1;
  }
}

export function monsterToTokenDefaults(
  monster: OwlbearMonster & { id?: string },
  gridSize: number,
): {
  name: string;
  hp: number;
  maxHp: number;
  ac: number;
  sizeCells: number;
  monsterId: string;
  monsterCr: string;
  monsterSource: string;
  imageUrl?: string;
  width: number;
  height: number;
} {
  const size = parseSizeFromType(monster.type);
  const cells = monsterSizeToCells(size);
  return {
    name: monster.name,
    hp: monster.hp,
    maxHp: monster.hp,
    ac: monster.ac,
    sizeCells: cells,
    monsterId: monster.id ?? slugify(monster.name),
    monsterCr: String(monster.cr),
    monsterSource: monster.source,
    width: cells * gridSize,
    height: cells * gridSize,
    ...((monster as OwlbearMonster & { imageUrl?: string }).imageUrl
      ? { imageUrl: (monster as OwlbearMonster & { imageUrl?: string }).imageUrl }
      : monster.image
        ? { imageUrl: monster.image }
        : {}),
  };
}

/** Skip PDF table-of-contents junk during import. */
export function isLikelyValidItem(entry: { name: string; type?: string; description?: string }): boolean {
  const name = entry.name?.trim() ?? '';
  if (!name || name.length < 2) return false;
  const skipNames = new Set(['plus new', 'uncommon', 'common', 'rare', 'very rare', 'legendary', 'artifact']);
  if (skipNames.has(name.toLowerCase())) return false;
  if (!entry.type?.trim() && (entry.description?.includes('Item Type') ?? false)) return false;
  return true;
}
