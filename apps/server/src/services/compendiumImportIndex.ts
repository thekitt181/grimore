import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { DDB_HOMEBREW_SOURCE_LABEL } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import { entryNameKey } from './compendiumMerge';
import { readTypedImportNameSourceRows } from './compendiumMongoReads';
import { entryMatchesSource } from './compendiumVisibility';

type NameSourceRow = {
  name: string;
  source?: string;
  brokenDuration?: boolean;
  /** Trimmed description length — used to detect incomplete (partial-fetch) imports. */
  descLen?: number;
  /** True when the stored description is just the entry name (normalize fallback = no real detail). */
  descEqualsName?: boolean;
};

const OVERRIDE_FIELD: Record<CompendiumKind, keyof OwlbearRawGlobalDoc> = {
  monster: 'overrideMonsters',
  item: 'overrideItems',
  spell: 'overrideSpells',
};

/**
 * An imported entry is "complete" only when it carries real detail text. Entries that
 * fell back to just their name (failed detail fetch) or contain `[object Object]` are
 * treated as missing so a re-import repairs them in full. `descLen === undefined` means
 * we never measured it (legacy/partial read) — assume complete to avoid needless re-fetch.
 */
function rowIsComplete(kind: CompendiumKind, row: NameSourceRow): boolean {
  if (row.brokenDuration) return false;
  if (row.descLen === undefined) return true;
  if (row.descLen <= 0) return false;
  if (row.descEqualsName) return false;
  if (kind === 'monster' && row.descLen < 150) return false;
  return true;
}

async function readKindNameSourceRows(kind: CompendiumKind): Promise<NameSourceRow[]> {
  if (isMongoCircuitOpen()) return [];
  const field = OVERRIDE_FIELD[kind];
  try {
    const col = await getCollection<OwlbearRawGlobalDoc>('data');
    if (!col) return [];
    const rows = await withMongoTimeout(() => col.aggregate([
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
                  descLen: {
                    $strLenCP: { $trim: { input: { $ifNull: ['$$e.description', ''] } } },
                  },
                  descEqualsName: {
                    $eq: [
                      { $toLower: { $trim: { input: { $ifNull: ['$$e.description', ''] } } } },
                      { $toLower: { $trim: { input: { $ifNull: ['$$e.name', ''] } } } },
                    ],
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
    return list
      .filter((r) => Boolean(r?.name?.trim()))
      .map((r) => ({ ...r, descEqualsName: r.descEqualsName && (r.descLen ?? 0) > 0 }));
  } catch {
    return [];
  }
}

function nameSourceRowKey(row: NameSourceRow): string {
  return `${entryNameKey(row.name)}|${(row.source ?? '').trim().toLowerCase()}`;
}

function mergeNameSourceRows(global: NameSourceRow[], typed: NameSourceRow[]): NameSourceRow[] {
  const map = new Map<string, NameSourceRow>();
  for (const row of global) {
    if (row.name?.trim()) map.set(nameSourceRowKey(row), row);
  }
  for (const row of typed) {
    if (row.name?.trim()) map.set(nameSourceRowKey(row), row);
  }
  return Array.from(map.values());
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
      return rows.some((r) => entryNameKey(r.name) === key && rowIsComplete(kind, r));
    }
    return rows.some((r) => {
      if (entryNameKey(r.name) !== key || !rowIsComplete(kind, r)) return false;
      if (entryMatchesSource(r.source, sourceLabel)) return true;
      // Legacy homebrew rows stored as source "Custom" before label preservation fix.
      return (
        sourceLabel === DDB_HOMEBREW_SOURCE_LABEL
        && (r.source === 'Custom' || !r.source?.trim())
      );
    });
  }

  /** Lightweight name+source rows for book list tallies (no stat blocks). */
  rowsForKind(kind: CompendiumKind): readonly NameSourceRow[] {
    return this.byKind[kind];
  }
}

let cachedIndex: { at: number; index: ImportSkipIndex } | null = null;
const INDEX_TTL_MS = 30_000;

/** Load name+source rows from Mongo overrides + typed collections (lightweight — no stat blocks). */
export async function loadImportSkipIndex(force = false): Promise<ImportSkipIndex> {
  const now = Date.now();
  if (!force && cachedIndex && now - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex.index;
  }
  const [
    globalMonster,
    globalItem,
    globalSpell,
    typedMonster,
    typedItem,
    typedSpell,
  ] = await Promise.all([
    readKindNameSourceRows('monster'),
    readKindNameSourceRows('item'),
    readKindNameSourceRows('spell'),
    readTypedImportNameSourceRows('monster'),
    readTypedImportNameSourceRows('item'),
    readTypedImportNameSourceRows('spell'),
  ]);
  const index = new ImportSkipIndex({
    monster: mergeNameSourceRows(globalMonster, typedMonster),
    item: mergeNameSourceRows(globalItem, typedItem),
    spell: mergeNameSourceRows(globalSpell, typedSpell),
  });
  cachedIndex = { at: now, index };
  return index;
}

export function invalidateImportSkipIndex(): void {
  cachedIndex = null;
}
