import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import { splitCompendiumSources } from '@grimoire/shared';
import { slugify } from '@grimoire/monster-dex';
import { loadRawGlobalFallback } from './compendiumGlobalFallback';
import { entryNameKey, namesMatch } from './compendiumMerge';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import type { BookSourceLabelBuckets } from './compendiumOwlbearPersist';
import { entryMatchesSource } from './compendiumVisibility';
import {
  collectImportedSourceLabelsFromPostgres,
  isCompendiumStorageUnavailable,
  readBookSourceLabelsFromPostgres,
  readOverrideCountsFromPostgres,
  readOverrideCountsFromTypedCollections as readTypedCountsFromPostgres,
  readOverrideEntriesFromPostgres,
  readOverrideEntryByIdFromPostgres,
  readOverrideEntryByNameFromPostgres,
  readTypedImportEntriesFromPostgres,
  readTypedImportNameSourceRows as readTypedNameSourceRowsFromPostgres,
  readTypedImportOverrideSlices as readTypedSlicesFromPostgres,
  TYPED_IMPORT_COLLECTION,
  typedImportOverrideCount,
  type TypedImportNameSourceRow,
} from './compendiumPostgres';

export { TYPED_IMPORT_COLLECTION, typedImportOverrideCount };
export type { TypedImportNameSourceRow };

type OverrideEntryMap = {
  monster: OwlbearMonster;
  item: OwlbearItem;
  spell: OwlbearSpell;
};

/** Per-entry Postgres rows (DDB imports) — replaces Mongo typed collections. */
export async function readTypedImportEntriesFromMongo<K extends CompendiumKind>(
  kind: K,
  opts?: { source?: string },
): Promise<OverrideEntryMap[K][]> {
  if (isCompendiumStorageUnavailable()) return [];
  return readTypedImportEntriesFromPostgres(kind, opts) as Promise<OverrideEntryMap[K][]>;
}

export async function readTypedImportOverrideSlices(): Promise<{
  overrideMonsters: OwlbearMonster[];
  overrideItems: OwlbearItem[];
  overrideSpells: OwlbearSpell[];
}> {
  return readTypedSlicesFromPostgres();
}

export async function readTypedImportNameSourceRows(kind: CompendiumKind): Promise<TypedImportNameSourceRow[]> {
  return readTypedNameSourceRowsFromPostgres(kind);
}

export async function readOverrideCountsFromTypedCollections(): Promise<{
  monsters: number;
  items: number;
  spells: number;
} | null> {
  return readTypedCountsFromPostgres();
}

export async function readOverrideEntriesFromMongo<K extends CompendiumKind>(
  kind: K,
  opts?: { source?: string },
): Promise<OverrideEntryMap[K][]> {
  const source = opts?.source?.trim();
  if (isCompendiumStorageUnavailable()) {
    const fallback = loadRawGlobalFallback();
    if (!fallback) return [];
    const field = kind === 'monster' ? 'overrideMonsters' : kind === 'item' ? 'overrideItems' : 'overrideSpells';
    const rows = (fallback[field] ?? []) as OverrideEntryMap[K][];
    if (!source) return rows;
    return rows.filter((entry) => entryMatchesSource(entry.source, source));
  }
  const rows = await readOverrideEntriesFromPostgres(kind) as OverrideEntryMap[K][];
  if (!source) return rows;
  return rows.filter((entry) => entryMatchesSource(entry.source, source));
}

export async function collectImportedSourceLabelsFromMongo(): Promise<{
  monsterSources: string[];
  itemSources: string[];
  spellSources: string[];
}> {
  if (isCompendiumStorageUnavailable()) {
    const fallback = loadRawGlobalFallback();
    if (!fallback) return { monsterSources: [], itemSources: [], spellSources: [] };
    return {
      monsterSources: [...new Set((fallback.overrideMonsters ?? []).map((m) => m.source).filter(Boolean) as string[])],
      itemSources: [...new Set((fallback.overrideItems ?? []).map((i) => i.source).filter(Boolean) as string[])],
      spellSources: [...new Set((fallback.overrideSpells ?? []).map((s) => s.source).filter(Boolean) as string[])],
    };
  }
  const buckets = await collectImportedSourceLabelsFromPostgres();
  return {
    monsterSources: buckets.monsterSources.filter(Boolean) as string[],
    itemSources: buckets.itemSources.filter(Boolean) as string[],
    spellSources: buckets.spellSources.filter(Boolean) as string[],
  };
}

/** Flat imported source label list (legacy callers). */
export async function collectImportedSourceLabelListFromMongo(): Promise<string[]> {
  const buckets = await collectImportedSourceLabelsFromMongo();
  return [...new Set([
    ...buckets.monsterSources,
    ...buckets.itemSources,
    ...buckets.spellSources,
  ].filter(Boolean) as string[])];
}

export async function readBookSourceLabelBucketsWithFallback(): Promise<BookSourceLabelBuckets | null> {
  const fromDb = await readBookSourceLabelsFromPostgres();
  if (fromDb && (fromDb.monsterSources.length + fromDb.itemSources.length + fromDb.spellSources.length) > 0) {
    return fromDb;
  }
  const fallback = loadRawGlobalFallback();
  if (!fallback) return fromDb;
  return {
    monsterSources: (fallback.overrideMonsters ?? []).map((m) => m.source),
    itemSources: (fallback.overrideItems ?? []).map((i) => i.source),
    spellSources: (fallback.overrideSpells ?? []).map((s) => s.source),
  };
}

export async function readOverrideEntryByNameFromMongo(
  kind: CompendiumKind,
  name: string,
): Promise<OwlbearMonster | OwlbearItem | OwlbearSpell | null> {
  if (isCompendiumStorageUnavailable()) return null;
  return readOverrideEntryByNameFromPostgres(kind, name);
}

export async function readOverrideEntryByIdFromMongo(
  kind: CompendiumKind,
  id: string,
  opts?: { source?: string },
): Promise<OwlbearMonster | OwlbearItem | OwlbearSpell | null> {
  if (isCompendiumStorageUnavailable()) return null;
  return readOverrideEntryByIdFromPostgres(kind, id, opts);
}

export async function readOverrideCountsFromMongo(): Promise<{
  monsters: number;
  items: number;
  spells: number;
} | null> {
  if (isCompendiumStorageUnavailable()) return null;
  return readOverrideCountsFromPostgres();
}

export { splitCompendiumSources, entryNameKey, namesMatch, slugify };
