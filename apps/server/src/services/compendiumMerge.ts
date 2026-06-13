import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import {
  loadLocalItems,
  loadLocalMonsters,
  loadLocalSpells,
} from './compendiumLocal';

export type OwlbearEntry = (OwlbearMonster | OwlbearItem | OwlbearSpell) & {
  originBookName?: string;
};

export function normalizeEntryName(name: string): string {
  return String(name || '').trim();
}

export function namesMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  return normalizeEntryName(a).toLowerCase() === normalizeEntryName(b).toLowerCase();
}

export function entryNameKey(name: string): string {
  return normalizeEntryName(name).toLowerCase();
}

export function dedupeByEntryName<T extends { name: string }>(entries: T[] | undefined): T[] {
  const map = new Map<string, T>();
  for (const entry of entries ?? []) {
    if (!entry?.name) continue;
    map.set(entryNameKey(entry.name), entry);
  }
  return Array.from(map.values());
}

export function buildHiddenBuiltInKeys(
  overrides: Array<{ name: string; originBookName?: string }>,
  deleted: string[],
): Set<string> {
  const keys = new Set<string>();
  for (const o of overrides) {
    keys.add(entryNameKey(o.name));
    if (o.originBookName) keys.add(entryNameKey(o.originBookName));
  }
  for (const d of deleted) keys.add(entryNameKey(d));
  return keys;
}

export function isHiddenBuiltIn(
  builtInName: string,
  hiddenKeys: Set<string>,
): boolean {
  return hiddenKeys.has(entryNameKey(builtInName));
}

let monsterBuiltInKeys: Set<string> | null = null;
let itemBuiltInKeys: Set<string> | null = null;
let spellBuiltInKeys: Set<string> | null = null;

function getBuiltInNameKeys(kind: 'monster' | 'item' | 'spell'): Set<string> {
  if (kind === 'monster') {
    if (!monsterBuiltInKeys) {
      monsterBuiltInKeys = new Set(loadLocalMonsters().map((m) => entryNameKey(m.name)));
    }
    return monsterBuiltInKeys;
  }
  if (kind === 'item') {
    if (!itemBuiltInKeys) {
      itemBuiltInKeys = new Set(loadLocalItems().map((i) => entryNameKey(i.name)));
    }
    return itemBuiltInKeys;
  }
  if (!spellBuiltInKeys) {
    spellBuiltInKeys = new Set(loadLocalSpells().map((s) => entryNameKey(s.name)));
  }
  return spellBuiltInKeys;
}

function isBuiltInName(kind: 'monster' | 'item' | 'spell', name: string): boolean {
  return getBuiltInNameKeys(kind).has(entryNameKey(name));
}

/** Strip custom entries that duplicate overrides, deleted originals, or built-in catalog names. */
export function filterCustomEntries<T extends OwlbearEntry>(
  kind: 'monster' | 'item' | 'spell',
  customs: T[] | undefined,
  overrides: T[],
  deleted: string[],
): T[] {
  const overrideNames = new Set(overrides.map((o) => entryNameKey(o.name)));
  const originNames = new Set(
    overrides
      .filter((o) => o.originBookName)
      .map((o) => entryNameKey(o.originBookName!)),
  );
  const deletedNames = new Set(deleted.map((d) => entryNameKey(d)));

  return dedupeByEntryName(customs).filter((entry) => {
    const name = entryNameKey(entry.name);
    if (overrideNames.has(name)) return false;
    if (originNames.has(name)) return false;
    if (deletedNames.has(name)) return false;
    if (entry.originBookName) return false;
    if (isBuiltInName(kind, entry.name)) return false;
    return true;
  });
}

/** Mirror Owlbear extension server normalizeLibraryData — dedupe overrides and filter customs. */
export function normalizeOwlbearRawDoc(raw: OwlbearRawGlobalDoc): OwlbearRawGlobalDoc {
  const overrideMonsters = dedupeByEntryName(raw.overrideMonsters);
  const overrideItems = dedupeByEntryName(raw.overrideItems);
  const overrideSpells = dedupeByEntryName(raw.overrideSpells);
  let deleted = [...(raw.deleted ?? [])];

  const ensureDeleted = (name: string) => {
    if (!name) return;
    if (!deleted.some((d) => namesMatch(d, name))) {
      deleted.push(normalizeEntryName(name));
    }
  };

  for (const override of [...overrideMonsters, ...overrideItems, ...overrideSpells] as OwlbearEntry[]) {
    if (override.originBookName && !namesMatch(override.originBookName, override.name)) {
      ensureDeleted(override.originBookName);
    }
  }

  return {
    ...raw,
    overrideMonsters,
    overrideItems,
    overrideSpells,
    monsters: filterCustomEntries('monster', raw.monsters, overrideMonsters, deleted),
    items: filterCustomEntries('item', raw.items, overrideItems, deleted),
    spells: filterCustomEntries('spell', raw.spells, overrideSpells, deleted),
    deleted,
  };
}
