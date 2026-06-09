import fs from 'fs';
import path from 'path';
import type { OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
import { isLikelyValidItem, slugify } from '@grimoire/monster-dex';

type StoredMonster = OwlbearMonster & { _id: string; isCustom?: boolean };
type StoredItem = OwlbearItem & { _id: string; isCustom?: boolean };
type StoredSpell = OwlbearSpell & { _id: string; isCustom?: boolean };

let cachedDir: string | null | undefined;
let cachedMonsters: StoredMonster[] | null = null;
let cachedItems: StoredItem[] | null = null;
let cachedSpells: StoredSpell[] | null = null;

function owlbearSrcDir(): string | null {
  if (cachedDir !== undefined) return cachedDir;
  const candidates = [
    process.env['OWLBear_DATA_DIR'],
    path.resolve(process.cwd(), '../../../owlbear_dnd_extension/src'),
    path.resolve(process.cwd(), '../../owlbear_dnd_extension/src'),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'monsters.json'))) {
      cachedDir = dir;
      return dir;
    }
  }
  cachedDir = null;
  return null;
}

export function isLocalCatalogAvailable(): boolean {
  return owlbearSrcDir() !== null;
}

function uniqueSlug(name: string, used: Set<string>): string {
  let base = slugify(name);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const id = `${base}-${n}`;
  used.add(id);
  return id;
}

export function loadLocalMonsters(): StoredMonster[] {
  if (cachedMonsters) return cachedMonsters;
  const dir = owlbearSrcDir();
  if (!dir) return [];
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'monsters.json'), 'utf8')) as OwlbearMonster[];
  const used = new Set<string>();
  cachedMonsters = raw.map((m) => ({ ...m, _id: uniqueSlug(m.name, used), isCustom: false }));
  return cachedMonsters;
}

export function loadLocalItems(): StoredItem[] {
  if (cachedItems) return cachedItems;
  const dir = owlbearSrcDir();
  if (!dir) return [];
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8')) as OwlbearItem[];
  const used = new Set<string>();
  cachedItems = raw.filter(isLikelyValidItem).map((i) => ({ ...i, _id: uniqueSlug(i.name, used), isCustom: false }));
  return cachedItems;
}

export function loadLocalSpells(): StoredSpell[] {
  if (cachedSpells) return cachedSpells;
  const dir = owlbearSrcDir();
  if (!dir) return [];
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'spells.json'), 'utf8')) as Record<string, Omit<OwlbearSpell, 'name'>>;
  const used = new Set<string>();
  cachedSpells = Object.entries(raw).map(([name, spell]) => ({
    ...spell,
    name,
    _id: uniqueSlug(name, used),
    isCustom: false,
  }));
  return cachedSpells;
}

export function getLocalMonsterById(id: string): StoredMonster | null {
  return loadLocalMonsters().find((m) => m._id === id) ?? null;
}

export function getLocalItemById(id: string): StoredItem | null {
  return loadLocalItems().find((i) => i._id === id) ?? null;
}

export function getLocalSpellById(id: string): StoredSpell | null {
  return loadLocalSpells().find((s) => s._id === id) ?? null;
}
