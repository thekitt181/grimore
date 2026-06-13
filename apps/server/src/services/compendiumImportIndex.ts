import { DDB_HOMEBREW_SOURCE_LABEL } from '@grimoire/shared';
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
const INDEX_TTL_MS = 120_000;

/** Load name+source rows from typed Mongo collections (lightweight — no stat blocks). */
export async function loadImportSkipIndex(force = false): Promise<ImportSkipIndex> {
  const now = Date.now();
  if (!force && cachedIndex && now - cachedIndex.at < INDEX_TTL_MS) {
    return cachedIndex.index;
  }
  const [typedMonster, typedItem, typedSpell] = await Promise.all([
    readTypedImportNameSourceRows('monster'),
    readTypedImportNameSourceRows('item'),
    readTypedImportNameSourceRows('spell'),
  ]);
  const index = new ImportSkipIndex({
    monster: typedMonster,
    item: typedItem,
    spell: typedSpell,
  });
  cachedIndex = { at: now, index };
  return index;
}

export function invalidateImportSkipIndex(): void {
  cachedIndex = null;
}
