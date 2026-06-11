import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import { entryNameKey } from './compendiumMerge';
import { entryMatchesSource } from './compendiumVisibility';

type NameSourceRow = { name: string; source?: string; brokenDuration?: boolean };

const OVERRIDE_FIELD: Record<CompendiumKind, keyof OwlbearRawGlobalDoc> = {
  monster: 'overrideMonsters',
  item: 'overrideItems',
  spell: 'overrideSpells',
};

async function readKindNameSourceRows(kind: CompendiumKind): Promise<NameSourceRow[]> {
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
            rows: {
              $map: {
                input: { $ifNull: [`$${field}`, []] },
                as: 'e',
                in: {
                  name: '$$e.name',
                  source: '$$e.source',
                  brokenDuration: {
                    $regexMatch: {
                      input: { $ifNull: ['$$e.description', ''] },
                      regex: '\\[object Object\\]',
                    },
                  },
                },
              },
            },
          },
        },
      ]).toArray(),
      20_000,
    );
    const list = (rows[0] as { rows?: NameSourceRow[] } | undefined)?.rows ?? [];
    return list.filter((r) => Boolean(r?.name?.trim()));
  } catch {
    return [];
  }
}

/** In-memory index of Mongo override entries for fast skip-during-reimport checks. */
export class ImportSkipIndex {
  private readonly byKind: Record<CompendiumKind, NameSourceRow[]>;

  constructor(rows: Record<CompendiumKind, NameSourceRow[]>) {
    this.byKind = rows;
  }

  get count(): number {
    return this.byKind.monster.length + this.byKind.item.length + this.byKind.spell.length;
  }

  has(kind: CompendiumKind, name: string, sourceLabel?: string): boolean {
    const key = entryNameKey(name);
    if (!key) return false;
    const rows = this.byKind[kind];
    if (!sourceLabel?.trim()) {
      return rows.some((r) => entryNameKey(r.name) === key && !r.brokenDuration);
    }
    return rows.some(
      (r) =>
        entryNameKey(r.name) === key &&
        entryMatchesSource(r.source, sourceLabel) &&
        !r.brokenDuration,
    );
  }
}

let cachedIndex: { at: number; index: ImportSkipIndex } | null = null;
const INDEX_TTL_MS = 30_000;

/** Load name+source rows from Mongo overrides (lightweight — no stat blocks). */
export async function loadImportSkipIndex(force = false): Promise<ImportSkipIndex> {
  const now = Date.now();
  if (!force && cachedIndex && now - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex.index;
  }
  const [monster, item, spell] = await Promise.all([
    readKindNameSourceRows('monster'),
    readKindNameSourceRows('item'),
    readKindNameSourceRows('spell'),
  ]);
  const index = new ImportSkipIndex({ monster, item, spell });
  cachedIndex = { at: now, index };
  return index;
}

export function invalidateImportSkipIndex(): void {
  cachedIndex = null;
}
