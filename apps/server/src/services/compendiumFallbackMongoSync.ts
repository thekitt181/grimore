import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, isMongoConfigured, withMongoTimeout } from '../lib/mongo';
import { entryNameKey, normalizeOwlbearRawDoc } from './compendiumMerge';
import {
  clearGlobalFallbackCache,
  globalFallbackFileRevision,
  loadRawGlobalFallback,
  saveGlobalFallback,
} from './compendiumGlobalFallback';
import {
  clearRawGlobalDocInflight,
  persistRawGlobalDoc,
} from './compendiumOwlbearPersist';
import { enqueueCompendiumWrite } from './compendiumWriteQueue';
import { newestIso } from './compendiumGlobal';

export type FallbackMongoSyncResult = {
  promoted: boolean;
  reason: string;
  mergedEntries?: number;
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

function mergeNamedEntries<T extends { name: string }>(
  mongoArr: T[] | undefined,
  fallbackArr: T[] | undefined,
): T[] {
  const map = new Map<string, T>();
  for (const entry of mongoArr ?? []) {
    if (entry?.name) map.set(entryNameKey(entry.name), entry);
  }
  for (const entry of fallbackArr ?? []) {
    if (entry?.name) map.set(entryNameKey(entry.name), entry);
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
  return rawEntryCount(fallback) > rawEntryCount(mongo);
}

async function readMongoRawGlobalDoc(): Promise<OwlbearRawGlobalDoc | null> {
  if (!isMongoConfigured() || isMongoCircuitOpen()) return null;
  const col = await getCollection<OwlbearRawGlobalDoc>('data');
  if (!col) return null;
  try {
    const doc = await withMongoTimeout(col.findOne({ _id: 'global' }), 15_000);
    return doc ? normalizeOwlbearRawDoc(doc) : null;
  } catch {
    return null;
  }
}

/**
 * When local fallback has imports Mongo missed (outage), merge and persist to Mongo.
 * Safe to call on startup, Mongo recovery, and finish-import.
 */
export async function promoteFallbackToMongo(reason: string): Promise<FallbackMongoSyncResult> {
  if (!isMongoConfigured()) {
    return { promoted: false, reason: 'Mongo not configured' };
  }
  if (isMongoCircuitOpen()) {
    return { promoted: false, reason: 'Mongo circuit open' };
  }

  const fallback = loadRawGlobalFallback();
  if (!fallback) {
    return { promoted: false, reason: 'No local fallback file' };
  }

  const normalizedFallback = normalizeOwlbearRawDoc(fallback);

  return enqueueCompendiumWrite(async () => {
    clearRawGlobalDocInflight();
    clearGlobalFallbackCache();

    const mongo = await readMongoRawGlobalDoc();
    if (!needsFallbackPromotion(mongo, normalizedFallback)) {
      if (mongo) {
        saveGlobalFallback(normalizeOwlbearGlobalDoc(mongo), mongo);
      }
      return { promoted: false, reason: 'Mongo already up to date' };
    }

    const merged = mongo
      ? mergeRawGlobalDocs(mongo, normalizedFallback)
      : normalizedFallback;

    const before = mongo ? rawEntryCount(mongo) : 0;
    const after = rawEntryCount(merged);
    const added = Math.max(0, after - before);

    const result = await persistRawGlobalDoc(merged, { notify: 'rebuild' });
    console.log(
      `[Compendium] Promoted local fallback → MongoDB (${reason})`
      + `${added > 0 ? ` — ~${added} entries merged` : ''}`
      + `${result.mongoPersisted ? '' : ' (Mongo write may have used mirror only)'}`,
    );

    return {
      promoted: true,
      reason,
      mergedEntries: after,
    };
  });
}

let syncInflight: Promise<FallbackMongoSyncResult> | null = null;

/** Debounced promote — runs once at a time. */
export function scheduleFallbackMongoSync(reason: string): void {
  if (syncInflight) return;
  syncInflight = promoteFallbackToMongo(reason)
    .catch((err) => {
      console.warn(
        '[Compendium] Fallback → Mongo sync failed:',
        err instanceof Error ? err.message : err,
      );
      return { promoted: false, reason: 'sync failed' };
    })
    .finally(() => {
      syncInflight = null;
    });
}
