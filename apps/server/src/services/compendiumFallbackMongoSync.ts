import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import { isCompendiumStorageUnavailable, readRawGlobalDocFromPostgres } from './compendiumPostgres';
import { entryNameKey, normalizeOwlbearRawDoc } from './compendiumMerge';
import { compendiumCatalogMergeKey } from './compendiumEntryIdentity';
import {
  clearGlobalFallbackCache,
  globalFallbackFileRevision,
  loadRawGlobalFallback,
} from './compendiumGlobalFallback';
import {
  clearRawGlobalDocInflight,
  persistRawGlobalDoc,
} from './compendiumOwlbearPersist';
import {
  readTypedImportOverrideSlices,
  typedImportOverrideCount,
} from './compendiumMongoReads';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import { newestIso } from './compendiumGlobal';

export type FallbackMongoSyncResult = {
  promoted: boolean;
  reason: string;
  mergedEntries?: number;
  /** True when Mongo global, typed collections, and local fallback were aligned. */
  reconciled?: boolean;
};

function parseIsoMs(value: unknown): number {
  if (value == null || value === '') return 0;
  const ms = new Date(value as string | Date).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function rawEntryCount(raw: OwlbearRawGlobalDoc): number {
  return (raw.overrideMonsters?.length ?? 0)
    + (raw.overrideItems?.length ?? 0)
    + (raw.overrideSpells?.length ?? 0)
    + (raw.monsters?.length ?? 0)
    + (raw.items?.length ?? 0)
    + (raw.spells?.length ?? 0);
}

/** DDB imports live in override* arrays — compare these when deciding promotion / mirror safety. */
export function rawOverrideEntryCount(raw: OwlbearRawGlobalDoc): number {
  return (raw.overrideMonsters?.length ?? 0)
    + (raw.overrideItems?.length ?? 0)
    + (raw.overrideSpells?.length ?? 0);
}

function mergeNamedEntries<T extends { name: string; source?: string; _id?: string }>(
  mongoArr: T[] | undefined,
  fallbackArr: T[] | undefined,
): T[] {
  const map = new Map<string, T>();
  const keyOf = (entry: T) =>
    entry._id?.trim() || compendiumCatalogMergeKey(entry.name, entry.source);
  for (const entry of mongoArr ?? []) {
    if (entry?.name) map.set(keyOf(entry), entry);
  }
  for (const entry of fallbackArr ?? []) {
    if (entry?.name) map.set(keyOf(entry), entry);
  }
  return Array.from(map.values());
}

/** Merge Mongo + fallback raw docs; fallback wins on same entry name. */
export function mergeRawGlobalDocs(
  mongo: OwlbearRawGlobalDoc,
  fallback: OwlbearRawGlobalDoc,
): OwlbearRawGlobalDoc {
  const fallbackNewer = parseIsoMs(fallback.lastUpdated) > parseIsoMs(mongo.lastUpdated);
  const merged: OwlbearRawGlobalDoc = {
    _id: 'global',
    monsters: mergeNamedEntries<OwlbearMonster>(mongo.monsters, fallback.monsters),
    items: mergeNamedEntries<OwlbearItem>(mongo.items, fallback.items),
    spells: mergeNamedEntries<OwlbearSpell>(mongo.spells, fallback.spells),
    overrideMonsters: mergeNamedEntries<OwlbearMonster>(mongo.overrideMonsters, fallback.overrideMonsters),
    overrideItems: mergeNamedEntries<OwlbearItem>(mongo.overrideItems, fallback.overrideItems),
    overrideSpells: mergeNamedEntries<OwlbearSpell>(mongo.overrideSpells, fallback.overrideSpells),
    deleted: [...new Set([...(mongo.deleted ?? []), ...(fallback.deleted ?? [])])],
    images: { ...(mongo.images ?? {}), ...(fallback.images ?? {}) },
    imagesData: { ...(mongo.imagesData ?? {}), ...(fallback.imagesData ?? {}) },
    entryImages: { ...(mongo.entryImages ?? {}), ...(fallback.entryImages ?? {}) },
    lockedSources: fallbackNewer
      ? [...(fallback.lockedSources ?? [])]
      : [...new Set([...(mongo.lockedSources ?? []), ...(fallback.lockedSources ?? [])])],
    publishedEntryKeys: [
      ...new Set([...(mongo.publishedEntryKeys ?? []), ...(fallback.publishedEntryKeys ?? [])]),
    ],
    lastUpdated: newestIso(mongo.lastUpdated, fallback.lastUpdated, globalFallbackFileRevision() ?? undefined),
  };
  return normalizeOwlbearRawDoc(merged);
}

export function needsFallbackPromotion(
  mongo: OwlbearRawGlobalDoc | null,
  fallback: OwlbearRawGlobalDoc,
): boolean {
  if (!mongo) return true;
  const fileRev = globalFallbackFileRevision();
  const fallbackMs = Math.max(parseIsoMs(fallback.lastUpdated), parseIsoMs(fileRev));
  const mongoMs = parseIsoMs(mongo.lastUpdated);
  if (fallbackMs > mongoMs) return true;
  if (rawOverrideEntryCount(fallback) > rawOverrideEntryCount(mongo)) return true;
  return rawEntryCount(fallback) > rawEntryCount(mongo);
}

async function readMongoRawGlobalDoc(): Promise<OwlbearRawGlobalDoc | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    const doc = await readRawGlobalDocFromPostgres({ includeImageData: false });
    return doc ? normalizeOwlbearRawDoc(doc) : null;
  } catch {
    return null;
  }
}

function emptyRawGlobal(): OwlbearRawGlobalDoc {
  return normalizeOwlbearRawDoc({
    _id: 'global',
    overrideMonsters: [],
    overrideItems: [],
    overrideSpells: [],
    deleted: [],
    lastUpdated: new Date(0).toISOString(),
  });
}

/** Union Mongo global overrides, per-entry typed collections, and local fallback. */
export function buildUnifiedRawDoc(
  mongoGlobal: OwlbearRawGlobalDoc | null,
  typed: Awaited<ReturnType<typeof readTypedImportOverrideSlices>>,
  fallback: OwlbearRawGlobalDoc | null,
): OwlbearRawGlobalDoc {
  const base = mongoGlobal ?? fallback ?? emptyRawGlobal();
  const withTyped: OwlbearRawGlobalDoc = {
    ...base,
    overrideMonsters: mergeNamedEntries(
      mergeNamedEntries(base.overrideMonsters, fallback?.overrideMonsters),
      typed.overrideMonsters,
    ),
    overrideItems: mergeNamedEntries(
      mergeNamedEntries(base.overrideItems, fallback?.overrideItems),
      typed.overrideItems,
    ),
    overrideSpells: mergeNamedEntries(
      mergeNamedEntries(base.overrideSpells, fallback?.overrideSpells),
      typed.overrideSpells,
    ),
  };
  if (mongoGlobal && fallback) {
    return mergeRawGlobalDocs(withTyped, fallback);
  }
  return normalizeOwlbearRawDoc(withTyped);
}

/** Fast check — typed imports, global doc, and local file out of sync? */
export async function detectCompendiumStorageDrift(): Promise<boolean> {
  const fallback = loadRawGlobalFallback();
  const normalizedFallback = fallback ? normalizeOwlbearRawDoc(fallback) : null;
  const mongoGlobal = await readMongoRawGlobalDoc();
  let typed = { overrideMonsters: [] as OwlbearMonster[], overrideItems: [] as OwlbearItem[], overrideSpells: [] as OwlbearSpell[] };
  if (!isCompendiumStorageUnavailable()) {
    typed = await readTypedImportOverrideSlices();
  }
  const typedCount = typedImportOverrideCount(typed);
  const fallbackCount = normalizedFallback ? rawOverrideEntryCount(normalizedFallback) : 0;
  const mongoCount = mongoGlobal ? rawOverrideEntryCount(mongoGlobal) : 0;

  if (typedCount === 0 && fallbackCount === 0 && mongoCount === 0) return false;

  const unified = buildUnifiedRawDoc(mongoGlobal, typed, normalizedFallback);
  const unifiedCount = rawOverrideEntryCount(unified);

  if (unifiedCount > mongoCount) return true;
  if (unifiedCount > fallbackCount) return true;
  if (typedCount > 0 && mongoCount < typedCount) return true;
  if (typedCount > 0 && fallbackCount < typedCount) return true;
  if (normalizedFallback && mongoGlobal && needsFallbackPromotion(mongoGlobal, normalizedFallback)) return true;
  if (normalizedFallback && mongoGlobal && fallbackCount !== mongoCount) return true;
  return false;
}

/**
 * Merge Mongo global + typed DDB imports + local fallback, persist to both stores,
 * and sync typed collections so all three stay identical.
 */
export async function reconcileCompendiumStorage(reason: string): Promise<FallbackMongoSyncResult> {
  const fallback = loadRawGlobalFallback();
  const normalizedFallback = fallback ? normalizeOwlbearRawDoc(fallback) : null;

  return enqueueCompendiumWrite(async () => {
    clearRawGlobalDocInflight();
    clearGlobalFallbackCache();

    const mongoGlobal = await readMongoRawGlobalDoc();
    let typed = { overrideMonsters: [] as OwlbearMonster[], overrideItems: [] as OwlbearItem[], overrideSpells: [] as OwlbearSpell[] };
    if (!isCompendiumStorageUnavailable()) {
      typed = await readTypedImportOverrideSlices();
    }

    const merged = buildUnifiedRawDoc(mongoGlobal, typed, normalizedFallback);
    const mergedCount = rawOverrideEntryCount(merged);
    const mongoCount = mongoGlobal ? rawOverrideEntryCount(mongoGlobal) : 0;
    const fallbackCount = normalizedFallback ? rawOverrideEntryCount(normalizedFallback) : 0;
    const typedCount = typedImportOverrideCount(typed);

    const needsWrite =
      mergedCount === 0
        ? false
        : mergedCount > mongoCount
          || mergedCount > fallbackCount
          || (typedCount > 0 && (mongoCount < typedCount || fallbackCount < typedCount))
          || (normalizedFallback && mongoGlobal && needsFallbackPromotion(mongoGlobal, normalizedFallback))
          || (normalizedFallback && mongoGlobal && fallbackCount !== mongoCount);

    if (!needsWrite && mongoGlobal && normalizedFallback) {
      return {
        promoted: false,
        reconciled: true,
        reason: 'Mongo, typed collections, and local fallback already in sync',
      };
    }

    if (mergedCount === 0) {
      return { promoted: false, reconciled: true, reason: 'No imported overrides to reconcile' };
    }

    const result = await persistRawGlobalDoc(merged, { notify: 'none' });

    if (!isCompendiumStorageUnavailable()) {
      try {
        const { syncTypedCollectionsFromOverrides } = await import('./compendiumSync');
        await syncTypedCollectionsFromOverrides(merged);
      } catch (err) {
        console.warn(
          '[Compendium] Typed collection sync after reconcile failed:',
          err instanceof Error ? err.message : err,
        );
      }
    }

    const { invalidateBookSourcesCache } = await import('./compendiumBookSourcesCache');
    invalidateBookSourcesCache();
    const { invalidateImportSkipIndex } = await import('./compendiumImportIndex');
    invalidateImportSkipIndex();

    console.log(
      `[Compendium] Reconciled Mongo + local storage (${reason})`
      + ` — ${mergedCount} override entries`
      + `${typedCount > 0 ? ` (${typedCount} from typed collections)` : ''}`
      + `${result.mongoPersisted ? '' : ' (Mongo write used local mirror)'}`,
    );

    return {
      promoted: true,
      reconciled: true,
      reason,
      mergedEntries: mergedCount,
    };
  });
}

/** Reconcile only when drift is detected (book list, reads). */
export async function ensureCompendiumStorageReconciled(reason: string): Promise<FallbackMongoSyncResult> {
  const drift = await detectCompendiumStorageDrift();
  if (!drift) {
    return { promoted: false, reconciled: true, reason: 'already in sync' };
  }
  return reconcileCompendiumStorage(reason);
}

/**
 * When local fallback has imports Mongo missed (outage), merge and persist to Mongo.
 * Delegates to full storage reconcile (global + typed + local).
 */
export async function promoteFallbackToMongo(reason: string): Promise<FallbackMongoSyncResult> {
  if (isCompendiumStorageUnavailable()) {
    return { promoted: false, reason: 'Postgres unavailable' };
  }
  return reconcileCompendiumStorage(reason);
}

/** Mirror Mongo overrides to local data.json — uses full reconcile so typed imports are included. */
export async function mirrorMongoOverridesToFallback(reason: string): Promise<void> {
  await ensureCompendiumStorageReconciled(reason);
}

let syncInflight: Promise<FallbackMongoSyncResult> | null = null;

/** Debounced reconcile — runs once at a time. */
export function scheduleFallbackMongoSync(reason: string): void {
  if (syncInflight) return;
  syncInflight = reconcileCompendiumStorage(reason)
    .catch((err) => {
      console.warn(
        '[Compendium] Storage reconcile failed:',
        err instanceof Error ? err.message : err,
      );
      return { promoted: false, reason: 'sync failed' };
    })
    .finally(() => {
      syncInflight = null;
    });
}
