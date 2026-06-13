import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import { getCollection, isMongoCircuitOpen, withMongoTimeout } from '../lib/mongo';

/** Stay under MongoDB's 16MB BSON document limit. */
export const COMPENDIUM_BSON_SAFE_BYTES = 14 * 1024 * 1024;

const SHARD_PREFIX = 'compendium-shard';

export type OverrideShardField = 'overrideMonsters' | 'overrideItems' | 'overrideSpells';

export type OverrideShardMeta = Partial<Record<OverrideShardField, number>>;

function shardDocId(field: OverrideShardField, index: number): string {
  return `${SHARD_PREFIX}:${field}:${index}`;
}

export function estimateJsonBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return COMPENDIUM_BSON_SAFE_BYTES + 1;
  }
}

function chunkEntriesBySize<T>(entries: T[], maxBytes: number): T[][] {
  if (entries.length === 0) return [];
  const chunks: T[][] = [];
  let current: T[] = [];
  let currentSize = 2;

  for (const entry of entries) {
    const entrySize = estimateJsonBytes(entry);
    if (current.length > 0 && currentSize + entrySize + 1 > maxBytes) {
      chunks.push(current);
      current = [];
      currentSize = 2;
    }
    current.push(entry);
    currentSize += entrySize + (current.length > 1 ? 1 : 0);
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** Split large override arrays into separate Mongo docs (and strip them from the global doc). */
export function splitRawDocOverridesIntoShards(raw: OwlbearRawGlobalDoc): {
  global: OwlbearRawGlobalDoc;
  shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>;
  meta: OverrideShardMeta;
} {
  const perShardBudget = Math.floor(COMPENDIUM_BSON_SAFE_BYTES / 2);
  const meta: OverrideShardMeta = {};
  const shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }> = [];
  const global: OwlbearRawGlobalDoc = { ...raw };

  for (const field of ['overrideMonsters', 'overrideItems', 'overrideSpells'] as const) {
    const entries = (raw[field] as unknown[] | undefined) ?? [];
    if (entries.length === 0) {
      global[field] = [];
      continue;
    }
    const fieldBytes = estimateJsonBytes(entries);
    if (fieldBytes <= perShardBudget) {
      continue;
    }
    const chunks = chunkEntriesBySize(entries, perShardBudget);
    meta[field] = chunks.length;
    shards.push(
      ...chunks.map((chunk, index) => ({
        _id: shardDocId(field, index),
        field,
        entries: chunk,
      })),
    );
    global[field] = [];
  }

  if (Object.keys(meta).length > 0) {
    (global as OwlbearRawGlobalDoc & { overrideShards?: OverrideShardMeta }).overrideShards = meta;
  }

  return { global, shards, meta };
}

export function rawDocNeedsSharding(raw: OwlbearRawGlobalDoc): boolean {
  return estimateJsonBytes(raw) > COMPENDIUM_BSON_SAFE_BYTES;
}

export function isBsonTooLargeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /BSONObj size|document too large|16MB|16544/i.test(msg);
}

/** Load sharded override arrays and merge into the raw global doc. */
export async function loadOverrideShardsIntoRawDoc(
  raw: OwlbearRawGlobalDoc,
): Promise<OwlbearRawGlobalDoc> {
  const meta = (raw as OwlbearRawGlobalDoc & { overrideShards?: OverrideShardMeta }).overrideShards;
  if (!meta || isMongoCircuitOpen()) return raw;

  const col = await getCollection<{ _id: string; entries?: unknown[] }>('data');
  if (!col) return raw;

  const merged: OwlbearRawGlobalDoc = { ...raw };

  for (const field of ['overrideMonsters', 'overrideItems', 'overrideSpells'] as const) {
    const shardCount = meta[field] ?? 0;
    if (shardCount <= 0) continue;

    const loaded: unknown[] = [];
    for (let i = 0; i < shardCount; i++) {
      try {
        const doc = await withMongoTimeout(() => col.findOne({ _id: shardDocId(field, i) }, { projection: { entries: 1 } }),
          20_000,
        );
        if (doc?.entries?.length) loaded.push(...doc.entries);
      } catch (err) {
        console.warn(
          `[Compendium] Failed to read shard ${field}:${i}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    if (loaded.length > 0) {
      (merged as Record<string, unknown>)[field] = loaded;
    }
  }

  return merged;
}

/** Persist override shards. */
export async function persistOverrideShards(
  shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>,
  meta: OverrideShardMeta,
): Promise<boolean> {
  if (shards.length === 0) return true;
  const col = await getCollection('data');
  if (!col || isMongoCircuitOpen()) return false;

  const ops = [
    ...shards.map((shard) => ({
      replaceOne: {
        filter: { _id: shard._id as unknown as import('mongodb').ObjectId },
        replacement: { _id: shard._id, field: shard.field, entries: shard.entries },
        upsert: true,
      },
    })),
    {
      updateOne: {
        filter: { _id: 'global' as unknown as import('mongodb').ObjectId },
        update: { $set: { overrideShards: meta } },
      },
    },
  ] as import('mongodb').AnyBulkWriteOperation[];

  for (const field of ['overrideMonsters', 'overrideItems', 'overrideSpells'] as const) {
    const count = meta[field] ?? 0;
    for (let i = count; i < count + 32; i++) {
      ops.push({
        deleteOne: { filter: { _id: shardDocId(field, i) as unknown as import('mongodb').ObjectId } },
      });
    }
  }

  await withMongoTimeout(() => col.bulkWrite(ops, { ordered: false }), 60_000);
  return true;
}
