import fs from 'fs';
import path from 'path';
import type { OwlbearRawGlobalDoc } from '@grimoire/shared';
import {
  mergeLoadedShardsIntoRawDoc,
  splitRawDocOverridesIntoShards,
  type OverrideShardField,
  type OverrideShardMeta,
} from './compendiumGlobalShards';

const SHARD_FIELDS: OverrideShardField[] = ['overrideMonsters', 'overrideItems', 'overrideSpells'];

/** Local shard file path: global.json → global.shard.overrideMonsters.0.json */
export function fallbackShardFilePath(basePath: string, field: OverrideShardField, index: number): string {
  const dir = path.dirname(basePath);
  const base = path.basename(basePath, path.extname(basePath));
  return path.join(dir, `${base}.shard.${field}.${index}.json`);
}

function readShardFile(shardPath: string): unknown[] | null {
  try {
    if (!fs.existsSync(shardPath)) return null;
    const parsed = JSON.parse(fs.readFileSync(shardPath, 'utf8')) as { entries?: unknown[] };
    return Array.isArray(parsed.entries) ? parsed.entries : null;
  } catch (err) {
    console.warn(
      `[Compendium] Failed to read fallback shard ${shardPath}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Merge override shard files listed in overrideShards meta. */
export function loadFallbackShardsIntoRawDoc(raw: OwlbearRawGlobalDoc, basePath: string): OwlbearRawGlobalDoc {
  const meta = (raw as OwlbearRawGlobalDoc & { overrideShards?: OverrideShardMeta }).overrideShards;
  if (!meta) return raw;

  return mergeLoadedShardsIntoRawDoc(raw, (field, index) =>
    readShardFile(fallbackShardFilePath(basePath, field, index)),
  );
}

function removeShardFile(shardPath: string): void {
  try {
    if (fs.existsSync(shardPath)) fs.unlinkSync(shardPath);
  } catch {
    // best effort
  }
}

/** Delete shard files beyond the current meta counts (and all shards when unsharded). */
export function removeStaleFallbackShards(basePath: string, meta: OverrideShardMeta | null | undefined): void {
  for (const field of SHARD_FIELDS) {
    const keep = meta?.[field] ?? 0;
    for (let i = keep; i < keep + 64; i++) {
      removeShardFile(fallbackShardFilePath(basePath, field, i));
    }
  }
}

function writeShardFiles(
  basePath: string,
  shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>,
): void {
  fs.mkdirSync(path.dirname(basePath), { recursive: true });
  for (const shard of shards) {
    const index = Number(shard._id.split(':').pop());
    if (!Number.isFinite(index)) continue;
    const shardPath = fallbackShardFilePath(basePath, shard.field, index);
    fs.writeFileSync(
      shardPath,
      JSON.stringify({ field: shard.field, index, entries: shard.entries }, null, 2),
      'utf8',
    );
  }
}

/**
 * When the fallback file would exceed safe size, split override arrays into sibling shard files.
 * Returns the document to write as the main global.json (may have empty override* + overrideShards meta).
 */
export function prepareFallbackWritePayload(
  raw: OwlbearRawGlobalDoc,
): {
  main: Record<string, unknown>;
  shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>;
  meta: OverrideShardMeta;
} {
  const { global, shards, meta } = splitRawDocOverridesIntoShards(raw);
  return { main: global as Record<string, unknown>, shards, meta };
}

/** Write main global file plus any override shard files; remove stale shards. */
export function persistFallbackShardFiles(
  basePath: string,
  shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>,
  meta: OverrideShardMeta,
): void {
  if (shards.length > 0) {
    writeShardFiles(basePath, shards);
    console.log(
      `[Compendium] Saved ${shards.length} local fallback shard file(s) for large book import`,
    );
  }
  removeStaleFallbackShards(basePath, Object.keys(meta).length > 0 ? meta : null);
}

/** Max mtime across main global file and all listed shard files. */
export function fallbackBundleMtimeMs(mainPath: string): number {
  let max = 0;
  try {
    max = Math.max(max, fs.statSync(mainPath).mtimeMs);
  } catch {
    return 0;
  }

  try {
    const raw = JSON.parse(fs.readFileSync(mainPath, 'utf8')) as OwlbearRawGlobalDoc & {
      overrideShards?: OverrideShardMeta;
    };
    const meta = raw.overrideShards;
    if (!meta) return max;

    for (const field of SHARD_FIELDS) {
      const count = meta[field] ?? 0;
      for (let i = 0; i < count; i++) {
        const shardPath = fallbackShardFilePath(mainPath, field, i);
        try {
          max = Math.max(max, fs.statSync(shardPath).mtimeMs);
        } catch {
          // missing shard — ignore
        }
      }
    }
  } catch {
    // unreadable main — use main mtime only
  }

  return max;
}
