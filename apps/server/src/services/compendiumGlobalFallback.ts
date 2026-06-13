import fs from 'fs';
import path from 'path';
import type { CompendiumGlobalDoc, OwlbearRawGlobalDoc } from '@grimoire/shared';
import { normalizeOwlbearGlobalDoc } from '@grimoire/shared';
import {
  fallbackBundleMtimeMs,
  loadFallbackShardsIntoRawDoc,
  persistFallbackShardFiles,
  prepareFallbackWritePayload,
} from './compendiumFallbackShards';
import type { OverrideShardField, OverrideShardMeta } from './compendiumGlobalShards';

let cached: CompendiumGlobalDoc | null | undefined;
let cachedMtime = 0;

/** Bundled server mirror — survives Mongo outages on Render. */
function bundledGlobalJsonPath(): string {
  return path.resolve(__dirname, '../../data/global.json');
}

function globalJsonPath(): string | null {
  const candidates = [
    process.env['OWLBear_GLOBAL_PATH'],
    process.env['OWLBear_DATA_DIR']
      ? path.join(path.dirname(process.env['OWLBear_DATA_DIR']), 'server', 'data.json')
      : null,
    path.resolve(process.cwd(), 'apps/server/data/global.json'),
    path.resolve(process.cwd(), 'data/global.json'),
    bundledGlobalJsonPath(),
    path.resolve(process.cwd(), '../../../owlbear_dnd_extension/server/data.json'),
    path.resolve(process.cwd(), '../../owlbear_dnd_extension/server/data.json'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Path used for writes when Mongo is down — creates bundled mirror if needed. */
function writableGlobalJsonPath(): string {
  return globalJsonPath() ?? bundledGlobalJsonPath();
}

function fileMtimeMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

/** ISO timestamp from file mtime — includes shard files when present. */
export function globalFallbackFileRevision(): string | null {
  const filePath = globalJsonPath();
  if (!filePath) return null;
  const mtime = fallbackBundleMtimeMs(filePath);
  if (!mtime) return null;
  return new Date(mtime).toISOString();
}

/** Load raw Owlbear data.json (override* + custom arrays intact), merging all shard files. */
export function loadRawGlobalFallback(): OwlbearRawGlobalDoc | null {
  const filePath = globalJsonPath();
  if (!filePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OwlbearRawGlobalDoc;
    return loadFallbackShardsIntoRawDoc(raw, filePath);
  } catch {
    return null;
  }
}

/** Load custom monsters/items/spells/images from Owlbear local Mongo fallback file. */
export function loadGlobalFallback(force = false): CompendiumGlobalDoc | null {
  const filePath = globalJsonPath();
  if (!filePath) {
    cached = null;
    cachedMtime = 0;
    return null;
  }

  const mtime = fallbackBundleMtimeMs(filePath);
  if (!force && cached !== undefined && mtime === cachedMtime) {
    return cached;
  }

  try {
    const raw = loadRawGlobalFallback();
    if (!raw) {
      cached = null;
      cachedMtime = mtime;
      return null;
    }
    cached = normalizeOwlbearGlobalDoc(raw);
    cachedMtime = mtime;
    return cached;
  } catch (err) {
    console.error('[Compendium] Failed to read global fallback:', err);
    cached = null;
    cachedMtime = mtime;
    return null;
  }
}

export function clearGlobalFallbackCache(): void {
  cached = undefined;
  cachedMtime = 0;
}

/** Patch visibility policy fields in local data.json without rewriting the full catalog. */
export function patchRawGlobalFallbackPolicy(
  policy: { lockedSources: string[]; publishedEntryKeys: string[] },
  lastUpdated: string,
): void {
  const filePath = globalJsonPath() ?? bundledGlobalJsonPath();

  try {
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      return;
    }
    raw.lockedSources = policy.lockedSources;
    raw.publishedEntryKeys = policy.publishedEntryKeys;
    raw.lastUpdated = lastUpdated;
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2), 'utf8');
    cached = undefined;
    cachedMtime = fallbackBundleMtimeMs(filePath);
  } catch (err) {
    console.warn('[Compendium] Failed to patch fallback policy:', err);
  }
}

/** Persist global overrides to Owlbear data.json when MongoDB is unavailable (or as mirror). */
export function saveGlobalFallback(
  next: CompendiumGlobalDoc,
  rawMongo?: OwlbearRawGlobalDoc | Record<string, unknown>,
  preSplit?: {
    shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>;
    meta: OverrideShardMeta;
  },
): CompendiumGlobalDoc | null {
  const filePath = writableGlobalJsonPath();
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Record<string, unknown>;
    } catch {
      // start fresh if unreadable
    }

    const toWrite: Record<string, unknown> = {
      ...raw,
      deleted: rawMongo?.deleted ?? next.deleted ?? [],
      images: next.images ?? {},
      imagesData: next.imagesData ?? {},
      entryImages: next.entryImages ?? {},
      lastUpdated: next.lastUpdated,
    };

    if (rawMongo) {
      for (const key of [
        'monsters',
        'items',
        'spells',
        'overrideMonsters',
        'overrideItems',
        'overrideSpells',
        'lockedSources',
        'publishedEntryKeys',
      ] as const) {
        if (Array.isArray(rawMongo[key])) toWrite[key] = rawMongo[key];
        else if (rawMongo[key] !== undefined) toWrite[key] = rawMongo[key];
      }
      const rawRecord = rawMongo as Record<string, unknown>;
      if (rawRecord.overrideShards) {
        toWrite.overrideShards = rawRecord.overrideShards;
      }
    } else {
      toWrite.monsters = next.monsters ?? [];
      toWrite.items = next.items ?? [];
      toWrite.spells = next.spells ?? [];
    }

    let main: Record<string, unknown>;
    let shards: Array<{ _id: string; field: OverrideShardField; entries: unknown[] }>;
    let meta: OverrideShardMeta;

    if (preSplit && preSplit.shards.length > 0) {
      main = { ...toWrite, overrideShards: preSplit.meta };
      shards = preSplit.shards;
      meta = preSplit.meta;
    } else {
      const prepared = prepareFallbackWritePayload(toWrite as OwlbearRawGlobalDoc);
      main = { ...toWrite, ...prepared.main };
      shards = prepared.shards;
      meta = prepared.meta;
    }

    fs.writeFileSync(filePath, JSON.stringify(main, null, 2), 'utf8');
    persistFallbackShardFiles(filePath, shards, meta);

    cached = next;
    cachedMtime = fallbackBundleMtimeMs(filePath);
    if (shards.length > 0) {
      console.log('[Compendium] Saved global fallback to', filePath, `(${shards.length} shard files)`);
    } else {
      console.log('[Compendium] Saved global fallback to', filePath);
    }
    return next;
  } catch (err) {
    console.error('[Compendium] Failed to write global fallback:', err);
    return null;
  }
}
