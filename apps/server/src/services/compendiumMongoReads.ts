import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import { splitCompendiumSources } from '@grimoire/shared';
import { slugify } from '@grimoire/monster-dex';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import { loadRawGlobalFallback } from './compendiumGlobalFallback';
import { entryNameKey, namesMatch } from './compendiumMerge';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import type { BookSourceLabelBuckets } from './compendiumOwlbearPersist';
import { entryMatchesSource } from './compendiumVisibility';

const OVERRIDE_FIELD: Record<CompendiumKind, keyof OwlbearRawGlobalDoc> = {
  monster: 'overrideMonsters',
  item: 'overrideItems',
  spell: 'overrideSpells',
};

const MONGO_OVERRIDE_READ_MS = 45_000;

type OverrideEntryMap = {
  monster: OwlbearMonster;
  item: OwlbearItem;
  spell: OwlbearSpell;
};

const TYPED_IMPORT_COLLECTION: Record<CompendiumKind, string> = {
  monster: 'monsters',
  item: 'items',
  spell: 'spells',
};

function mergeOverrideEntryLists<T extends { name: string }>(base: T[], extra: T[]): T[] {
  if (extra.length === 0) return base;
  const map = new Map<string, T>();
  for (const entry of base) {
    if (entry?.name) map.set(entryNameKey(entry.name), entry);
  }
  for (const entry of extra) {
    if (entry?.name) map.set(entryNameKey(entry.name), entry);
  }
  return Array.from(map.values());
}

/** Per-entry Mongo collections (DDB imports) — not subject to the 16MB global doc limit. */
export async function readTypedImportEntriesFromMongo<K extends CompendiumKind>(
  kind: K,
  opts?: { source?: string },
): Promise<OverrideEntryMap[K][]> {
  if (isMongoCircuitOpen()) return [];
  const colName = TYPED_IMPORT_COLLECTION[kind];
  try {
    const col = await getCollection<OverrideEntryMap[K] & { _id?: string; isCustom?: boolean }>(colName);
    if (!col) return [];

    const source = opts?.source?.trim();
    const filter: Record<string, unknown> = {
      source: { $exists: true, $nin: ['Custom', ''] },
    };
    if (source) {
      filter.source = { $regex: escapeRegex(source), $options: 'i' };
    }

    const rows = await withMongoTimeout(
      col.find(filter as never, { projection: { _id: 0 } }).limit(25_000).toArray(),
      MONGO_OVERRIDE_READ_MS,
    );
    return rows.filter((entry) => !source || entryMatchesSource(entry.source, source)) as OverrideEntryMap[K][];
  } catch (err) {
    console.warn(
      `[Compendium] Typed ${kind} import read failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function readTypedImportOverrideSlices(): Promise<{
  overrideMonsters: OwlbearMonster[];
  overrideItems: OwlbearItem[];
  overrideSpells: OwlbearSpell[];
}> {
  const [overrideMonsters, overrideItems, overrideSpells] = await Promise.all([
    readTypedImportEntriesFromMongo('monster'),
    readTypedImportEntriesFromMongo('item'),
    readTypedImportEntriesFromMongo('spell'),
  ]);
  return { overrideMonsters, overrideItems, overrideSpells };
}

export function typedImportOverrideCount(slices: {
  overrideMonsters?: unknown[];
  overrideItems?: unknown[];
  overrideSpells?: unknown[];
}): number {
  return (slices.overrideMonsters?.length ?? 0)
    + (slices.overrideItems?.length ?? 0)
    + (slices.overrideSpells?.length ?? 0);
}

export async function readOverrideCountsFromTypedCollections(): Promise<{
  monsters: number;
  items: number;
  spells: number;
} | null> {
  if (isMongoCircuitOpen()) return null;
  try {
    const counts = { monsters: 0, items: 0, spells: 0 };
    for (const kind of ['monster', 'item', 'spell'] as const) {
      const col = await getCollection(TYPED_IMPORT_COLLECTION[kind]);
      if (!col) continue;
      counts[kind === 'monster' ? 'monsters' : kind === 'item' ? 'items' : 'spells'] = await withMongoTimeout(
        col.countDocuments({ source: { $exists: true, $nin: ['Custom', ''] } }),
        15_000,
      );
    }
    if (counts.monsters + counts.items + counts.spells === 0) return null;
    return counts;
  } catch {
    return null;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readOverrideEntriesFromFallback<K extends CompendiumKind>(
  kind: K,
  source?: string,
): OverrideEntryMap[K][] {
  const fallback = loadRawGlobalFallback();
  if (!fallback) return [];
  const field = OVERRIDE_FIELD[kind];
  let entries = (fallback[field] as OverrideEntryMap[K][] | undefined) ?? [];
  if (source) {
    entries = entries.filter((e) => entryMatchesSource(e.source, source));
  }
  return entries;
}

/** Load one override array from Mongo — merges typed per-entry collections when global doc is incomplete. */
export async function readOverrideEntriesFromMongo<K extends CompendiumKind>(
  kind: K,
  opts?: { source?: string },
): Promise<OverrideEntryMap[K][]> {
  const source = opts?.source?.trim();
  const fallbackEntries = readOverrideEntriesFromFallback(kind, source);

  if (isMongoCircuitOpen()) {
    const typedEntries = await readTypedImportEntriesFromMongo(
      kind,
      source ? { source } : undefined,
    );
    if (typedEntries.length > 0) {
      return mergeOverrideEntryLists(fallbackEntries, typedEntries);
    }
    return fallbackEntries;
  }

  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return fallbackEntries;

    const field = OVERRIDE_FIELD[kind];
    let entries: OverrideEntryMap[K][];

    if (source) {
      const rows = await withMongoTimeout(
        col.aggregate([
          { $match: { _id: 'global' } },
          {
            $project: {
              entries: {
                $filter: {
                  input: { $ifNull: [`$${field}`, []] },
                  as: 'e',
                  cond: {
                    $regexMatch: {
                      input: { $ifNull: ['$$e.source', ''] },
                      regex: escapeRegex(source),
                      options: 'i',
                    },
                  },
                },
              },
            },
          },
        ]).toArray(),
        MONGO_OVERRIDE_READ_MS,
      );
      entries = ((rows[0] as { entries?: OverrideEntryMap[K][] } | undefined)?.entries ?? []);
      entries = entries.filter((e) => entryMatchesSource(e.source, source));
    } else {
      const doc = await withMongoTimeout(
        col.findOne({ _id: 'global' }, { projection: { [field]: 1 } }),
        MONGO_OVERRIDE_READ_MS,
      );
      entries = (doc?.[field] as OverrideEntryMap[K][] | undefined) ?? [];
    }

    if (entries.length === 0 && fallbackEntries.length > 0) {
      return fallbackEntries;
    }
    const typedEntries = await readTypedImportEntriesFromMongo(
      kind,
      source ? { source } : undefined,
    );
    if (typedEntries.length > 0) {
      entries = mergeOverrideEntryLists(entries, typedEntries);
    }
    if (fallbackEntries.length > entries.length) {
      console.warn(
        `[Compendium] Mongo ${kind} overrides (${entries.length}) < local fallback (${fallbackEntries.length}) — merging`,
      );
      const { scheduleFallbackMongoSync } = await import('./compendiumFallbackMongoSync');
      scheduleFallbackMongoSync('override-read-merge');
      entries = mergeOverrideEntryLists(fallbackEntries, entries);
    } else if (fallbackEntries.length > 0) {
      entries = mergeOverrideEntryLists(entries, fallbackEntries);
    }
    return entries;
  } catch (err) {
    console.warn(
      `[Compendium] Mongo override read (${kind}${source ? `, source=${source}` : ''}) failed:`,
      err instanceof Error ? err.message : err,
    );
    const typedEntries = await readTypedImportEntriesFromMongo(
      kind,
      source ? { source } : undefined,
    );
    if (typedEntries.length > 0) return typedEntries;
    return fallbackEntries;
  }
}

function labelBucketCount(buckets: BookSourceLabelBuckets): number {
  return buckets.monsterSources.length + buckets.itemSources.length + buckets.spellSources.length;
}

/** Per-kind source label read — smaller aggregation than all three arrays at once. */
async function readKindSourceLabelsFromMongo(
  kind: CompendiumKind,
): Promise<Array<string | undefined>> {
  if (isMongoCircuitOpen()) return [];
  const field = OVERRIDE_FIELD[kind];
  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return [];
    const rows = await withMongoTimeout(
      col.aggregate([
        { $match: { _id: 'global' } },
        {
          $project: {
            sources: {
              $map: {
                input: { $ifNull: [`$${field}`, []] },
                as: 'e',
                in: '$$e.source',
              },
            },
          },
        },
      ]).toArray(),
      45_000,
    );
    return (rows[0] as { sources?: Array<string | undefined> } | undefined)?.sources ?? [];
  } catch {
    return [];
  }
}

/**
 * Book source labels for Compendium → Books.
 * Tries full aggregation first, then per-kind reads if the combined pipeline fails.
 */
export async function readBookSourceLabelBucketsWithFallback(): Promise<BookSourceLabelBuckets | null> {
  const { readBookSourceLabelsFromMongo } = await import('./compendiumOwlbearPersist');
  const combined = await readBookSourceLabelsFromMongo();
  if (combined && labelBucketCount(combined) > 0) return combined;

  const counts = await readOverrideCountsFromMongo();
  if (!counts || counts.monsters + counts.items + counts.spells === 0) return combined;

  console.warn('[Compendium] Combined book-label aggregation empty — trying per-kind source reads');
  const monsterSources = await readKindSourceLabelsFromMongo('monster');
  const itemSources = await readKindSourceLabelsFromMongo('item');
  const spellSources = await readKindSourceLabelsFromMongo('spell');
  const buckets: BookSourceLabelBuckets = { monsterSources, itemSources, spellSources };
  if (labelBucketCount(buckets) === 0) return combined;
  return buckets;
}

/** Unique imported source labels from Mongo override arrays (no full global doc read). */
export async function collectImportedSourceLabelsFromMongo(): Promise<string[]> {
  const buckets = await readBookSourceLabelBucketsWithFallback();
  const labels = new Set<string>();
  const add = (sources: Array<string | undefined>) => {
    for (const source of sources) {
      for (const part of splitCompendiumSources(source)) {
        const trimmed = part.trim();
        if (trimmed && trimmed.toLowerCase() !== 'custom' && trimmed !== 'D&D Beyond') {
          labels.add(trimmed);
        }
      }
    }
  };
  if (buckets) {
    add(buckets.monsterSources);
    add(buckets.itemSources);
    add(buckets.spellSources);
  }
  for (const kind of ['monster', 'item', 'spell'] as const) {
    if (isMongoCircuitOpen()) break;
    try {
      const col = await getCollection(TYPED_IMPORT_COLLECTION[kind]);
      if (!col) continue;
      const sources = await withMongoTimeout(
        col.distinct('source', { source: { $exists: true, $nin: ['Custom', ''] } }),
        15_000,
      );
      add(sources.map((s) => String(s)));
    } catch {
      // ignore — global buckets may still have labels
    }
  }
  return [...labels];
}

/** Names only — tiny payload for id → name resolution. */
async function readOverrideEntryNamesFromMongo(kind: CompendiumKind): Promise<string[]> {
  if (isMongoCircuitOpen()) return [];
  const field = OVERRIDE_FIELD[kind];
  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return [];
    const rows = await withMongoTimeout(
      col.aggregate([
        { $match: { _id: 'global' } },
        {
          $project: {
            names: {
              $map: {
                input: { $ifNull: [`$${field}`, []] },
                as: 'e',
                in: '$$e.name',
              },
            },
          },
        },
      ]).toArray(),
      20_000,
    );
    const names = (rows[0] as { names?: string[] } | undefined)?.names ?? [];
    return names.filter((n): n is string => Boolean(n?.trim()));
  } catch {
    return [];
  }
}

/** Fetch a single override entry by exact name (one stat block, not the full array). */
export async function readOverrideEntryByNameFromMongo<K extends CompendiumKind>(
  kind: K,
  name: string,
): Promise<OverrideEntryMap[K] | null> {
  if (isMongoCircuitOpen() || !name.trim()) return null;
  const field = OVERRIDE_FIELD[kind];
  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return null;
    const rows = await withMongoTimeout(
      col.aggregate([
        { $match: { _id: 'global' } },
        {
          $project: {
            entry: {
              $arrayElemAt: [
                {
                  $filter: {
                    input: { $ifNull: [`$${field}`, []] },
                    as: 'e',
                    cond: { $eq: ['$$e.name', name] },
                  },
                },
                0,
              ],
            },
          },
        },
      ]).toArray(),
      MONGO_OVERRIDE_READ_MS,
    );
    const entry = (rows[0] as { entry?: OverrideEntryMap[K] } | undefined)?.entry;
    return entry ?? null;
  } catch (err) {
    console.warn(
      `[Compendium] Mongo override entry read (${kind}, ${name}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Resolve compendium id (slug) to one Mongo override entry without loading all overrides. */
export async function readOverrideEntryByIdFromMongo<K extends CompendiumKind>(
  kind: K,
  id: string,
): Promise<OverrideEntryMap[K] | null> {
  const slug = id.trim().toLowerCase();
  if (!slug) return null;

  const names = await readOverrideEntryNamesFromMongo(kind);
  const matched = names.find((name) => slugify(name) === slug || namesMatch(name, id));
  if (!matched) return null;

  let entry = await readOverrideEntryByNameFromMongo(kind, matched);
  if (entry) return entry;

  const alt = names.find((name) => slugify(name) === slug);
  if (alt && alt !== matched) {
    entry = await readOverrideEntryByNameFromMongo(kind, alt);
  }
  return entry ?? null;
}

/** Count override entries per kind without loading stat blocks (for sync status / cache checks). */
export async function readOverrideCountsFromMongo(): Promise<{
  monsters: number;
  items: number;
  spells: number;
} | null> {
  if (isMongoCircuitOpen()) return null;
  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return null;
    const rows = await withMongoTimeout(
      col.aggregate([
        { $match: { _id: 'global' } },
        {
          $project: {
            monsters: { $size: { $ifNull: ['$overrideMonsters', []] } },
            items: { $size: { $ifNull: ['$overrideItems', []] } },
            spells: { $size: { $ifNull: ['$overrideSpells', []] } },
          },
        },
      ]).toArray(),
      15_000,
    );
    const doc = rows[0] as { monsters?: number; items?: number; spells?: number } | undefined;
    if (!doc) return null;
    return {
      monsters: doc.monsters ?? 0,
      items: doc.items ?? 0,
      spells: doc.spells ?? 0,
    };
  } catch {
    return null;
  }
}
