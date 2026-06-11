import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import type { CompendiumKind } from './compendiumOwlbearPersist';
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Load one override array from Mongo — never pulls the full global document. */
export async function readOverrideEntriesFromMongo<K extends CompendiumKind>(
  kind: K,
  opts?: { source?: string },
): Promise<OverrideEntryMap[K][]> {
  if (isMongoCircuitOpen()) return [];

  const field = OVERRIDE_FIELD[kind];
  const source = opts?.source?.trim();

  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return [];

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

    return entries;
  } catch (err) {
    console.warn(
      `[Compendium] Mongo override read (${kind}${source ? `, source=${source}` : ''}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
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
