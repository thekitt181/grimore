import type { Prisma } from '@prisma/client';
import { CompendiumEntryKind } from '@prisma/client';
import type {
  OwlbearItem,
  OwlbearMonster,
  OwlbearRawGlobalDoc,
  OwlbearSpell,
} from '@grimoire/shared';
import { slugify } from '@grimoire/monster-dex';
import { prisma } from '../lib/prisma';
import { entryNameKey, normalizeOwlbearRawDoc } from './compendiumMerge';
import { compendiumEntryStorageId } from './compendiumEntryIdentity';
import type { CompendiumKind } from './compendiumOwlbearPersist';
import type { BookSourceLabelBuckets } from './compendiumOwlbearPersist';
import { entryMatchesSource } from './compendiumVisibility';

export type CompendiumStorageKind = CompendiumKind;

const KIND_TO_PRISMA: Record<CompendiumStorageKind, CompendiumEntryKind> = {
  monster: CompendiumEntryKind.MONSTER,
  item: CompendiumEntryKind.ITEM,
  spell: CompendiumEntryKind.SPELL,
};

const PRISMA_TO_KIND: Record<CompendiumEntryKind, CompendiumStorageKind> = {
  [CompendiumEntryKind.MONSTER]: 'monster',
  [CompendiumEntryKind.ITEM]: 'item',
  [CompendiumEntryKind.SPELL]: 'spell',
};

export const TYPED_IMPORT_COLLECTION: Record<CompendiumStorageKind, string> = {
  monster: 'monsters',
  item: 'items',
  spell: 'spells',
};

const UPSERT_BATCH = 100;

let storageUnavailable = false;
let lastStorageError: string | null = null;
let lastStorageCheckAt: string | null = null;
let lastStorageSuccessAt: string | null = null;
let lastStorageLatencyMs: number | null = null;

export function isCompendiumStorageUnavailable(): boolean {
  return storageUnavailable;
}

export function getCompendiumStorageHealthSnapshot() {
  return {
    state: storageUnavailable
      ? 'unavailable' as const
      : 'connected' as const,
    configured: true,
    circuitOpen: storageUnavailable,
    lastCheckedAt: lastStorageCheckAt ?? undefined,
    lastSuccessAt: lastStorageSuccessAt ?? undefined,
    lastError: lastStorageError ?? undefined,
    latencyMs: lastStorageLatencyMs ?? undefined,
  };
}

async function withStorageProbe<T>(fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const result = await fn();
    storageUnavailable = false;
    lastStorageError = null;
    lastStorageCheckAt = new Date().toISOString();
    lastStorageSuccessAt = lastStorageCheckAt;
    lastStorageLatencyMs = Date.now() - started;
    return result;
  } catch (err) {
    storageUnavailable = true;
    lastStorageError = err instanceof Error ? err.message : String(err);
    lastStorageCheckAt = new Date().toISOString();
    lastStorageLatencyMs = Date.now() - started;
    throw err;
  }
}

export async function pingCompendiumStorage(): Promise<boolean> {
  try {
    await withStorageProbe(() => prisma.compendiumMeta.findUnique({ where: { id: 'global' } }));
    return true;
  } catch {
    return false;
  }
}

async function ensureCompendiumMeta(): Promise<void> {
  await prisma.compendiumMeta.upsert({
    where: { id: 'global' },
    create: {
      id: 'global',
      deleted: [],
      lockedSources: [],
      publishedEntryKeys: [],
    },
    update: {},
  });
}

export async function touchCompendiumMeta(lastUpdated = new Date()): Promise<string> {
  await ensureCompendiumMeta();
  const row = await prisma.compendiumMeta.update({
    where: { id: 'global' },
    data: { lastUpdated },
  });
  return row.lastUpdated.toISOString();
}

function rowToMonster(row: {
  id: string;
  name: string;
  source: string;
  payload: Prisma.JsonValue;
  isCustom: boolean;
  originBookName: string | null;
}): OwlbearMonster & { _id?: string; isCustom?: boolean; originBookName?: string } {
  const payload = (typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload))
    ? row.payload as Record<string, unknown>
    : {};
  const merged = { ...payload, name: row.name, source: row.source || (payload.source as string) || '' } as OwlbearMonster;
  return {
    ...merged,
    _id: row.id,
    isCustom: row.isCustom,
    ...(row.originBookName ? { originBookName: row.originBookName } : {}),
  };
}

function rowToItem(row: Parameters<typeof rowToMonster>[0]): OwlbearItem & { _id?: string; isCustom?: boolean } {
  return rowToMonster(row) as OwlbearItem & { _id?: string; isCustom?: boolean };
}

function rowToSpell(row: Parameters<typeof rowToMonster>[0]): OwlbearSpell & { _id?: string; isCustom?: boolean } {
  return rowToMonster(row) as unknown as OwlbearSpell & { _id?: string; isCustom?: boolean };
}

function rowToEntry(kind: CompendiumStorageKind, row: Parameters<typeof rowToMonster>[0]) {
  if (kind === 'monster') return rowToMonster(row);
  if (kind === 'item') return rowToItem(row);
  return rowToSpell(row);
}

function entryPayload(entry: OwlbearMonster | OwlbearItem | OwlbearSpell): Prisma.InputJsonValue {
  return entry as unknown as Prisma.InputJsonValue;
}

function buildUpsertData(
  kind: CompendiumStorageKind,
  entry: OwlbearMonster | OwlbearItem | OwlbearSpell,
  flags: {
    isCustom: boolean;
    inTypedImport?: boolean;
    inGlobalOverride?: boolean;
    inGlobalHomebrew?: boolean;
    originBookName?: string | null;
  },
) {
  const id = compendiumEntryStorageId(
    entry.name,
    entry.source?.trim() || (flags.isCustom ? 'Custom' : ''),
    ('_id' in entry ? (entry as { _id?: string })._id : undefined),
  );
  const originBookName =
    flags.originBookName
    ?? ('originBookName' in entry ? (entry.originBookName as string | undefined) : undefined)
    ?? null;
  return {
    id,
    kind: KIND_TO_PRISMA[kind],
    name: entry.name,
    nameKey: entryNameKey(entry.name),
    source: entry.source?.trim() || (flags.isCustom ? 'Custom' : ''),
    payload: entryPayload(entry),
    isCustom: flags.isCustom,
    originBookName,
    inTypedImport: flags.inTypedImport ?? false,
    inGlobalOverride: flags.inGlobalOverride ?? false,
    inGlobalHomebrew: flags.inGlobalHomebrew ?? false,
  };
}

export async function upsertTypedImportEntriesBulk(
  kind: CompendiumStorageKind,
  entries: Array<{ entry: OwlbearMonster | OwlbearItem | OwlbearSpell; isCustom: boolean }>,
): Promise<void> {
  if (entries.length === 0) return;
  await withStorageProbe(async () => {
    for (let i = 0; i < entries.length; i += UPSERT_BATCH) {
      const batch = entries.slice(i, i + UPSERT_BATCH);
      await prisma.$transaction(
        batch.map(({ entry, isCustom }) => {
          const data = buildUpsertData(kind, entry, {
            isCustom,
            inTypedImport: true,
            inGlobalOverride: !isCustom,
            inGlobalHomebrew: isCustom,
          });
          return prisma.compendiumEntry.upsert({
            where: { id: data.id },
            create: data,
            update: {
              kind: data.kind,
              name: data.name,
              nameKey: data.nameKey,
              source: data.source,
              payload: data.payload,
              isCustom: data.isCustom,
              originBookName: data.originBookName,
              inTypedImport: true,
              ...(isCustom
                ? { inGlobalHomebrew: true }
                : { inGlobalOverride: true }),
            },
          });
        }),
      );
    }
    await touchCompendiumMeta();
  });
}

export async function deleteCompendiumEntryBySlug(id: string): Promise<void> {
  await withStorageProbe(async () => {
    await prisma.compendiumEntry.deleteMany({ where: { id } });
    await touchCompendiumMeta();
  });
}

async function readEntriesByKind(
  kind: CompendiumStorageKind,
  where: Prisma.CompendiumEntryWhereInput,
): Promise<Array<OwlbearMonster | OwlbearItem | OwlbearSpell>> {
  if (isCompendiumStorageUnavailable()) return [];
  try {
    const rows = await withStorageProbe(() => prisma.compendiumEntry.findMany({
      where: { kind: KIND_TO_PRISMA[kind], ...where },
      orderBy: { name: 'asc' },
    }));
    return rows.map((row) => rowToEntry(kind, row));
  } catch (err) {
    console.warn(
      `[Compendium] Postgres ${kind} read failed:`,
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}

export async function readTypedImportEntriesFromPostgres<K extends CompendiumStorageKind>(
  kind: K,
  opts?: { source?: string },
): Promise<Array<OwlbearMonster | OwlbearItem | OwlbearSpell>> {
  const source = opts?.source?.trim();
  const rows = await readEntriesByKind(kind, { inTypedImport: true });
  if (!source) return rows;
  return rows.filter((entry) => entryMatchesSource(entry.source, source));
}

export async function readTypedImportOverrideSlices(): Promise<{
  overrideMonsters: OwlbearMonster[];
  overrideItems: OwlbearItem[];
  overrideSpells: OwlbearSpell[];
}> {
  const [overrideMonsters, overrideItems, overrideSpells] = await Promise.all([
    readTypedImportEntriesFromPostgres('monster'),
    readTypedImportEntriesFromPostgres('item'),
    readTypedImportEntriesFromPostgres('spell'),
  ]);
  return {
    overrideMonsters: overrideMonsters as OwlbearMonster[],
    overrideItems: overrideItems as OwlbearItem[],
    overrideSpells: overrideSpells as OwlbearSpell[],
  };
}

export type TypedImportNameSourceRow = {
  name: string;
  source?: string;
  brokenDuration?: boolean;
  descLen?: number;
  descEqualsName?: boolean;
};

export async function readTypedImportNameSourceRows(
  kind: CompendiumStorageKind,
): Promise<TypedImportNameSourceRow[]> {
  if (isCompendiumStorageUnavailable()) return [];
  try {
    const rows = await withStorageProbe(() => prisma.compendiumEntry.findMany({
      where: { kind: KIND_TO_PRISMA[kind], inTypedImport: true },
      select: { name: true, source: true, payload: true },
    }));
    return rows.map((row) => {
      const payload = (typeof row.payload === 'object' && row.payload !== null && !Array.isArray(row.payload))
        ? row.payload as Record<string, unknown>
        : {};
      const desc = String(payload.description ?? '').trim();
      const name = row.name.trim();
      return {
        name: row.name,
        source: row.source || undefined,
        brokenDuration: /\[object Object\]/.test(desc),
        descLen: desc.length,
        descEqualsName: desc.length > 0 && desc.toLowerCase() === name.toLowerCase(),
      };
    });
  } catch {
    return [];
  }
}

export async function readOverrideCountsFromTypedCollections(): Promise<{
  monsters: number;
  items: number;
  spells: number;
} | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    const [monsters, items, spells] = await withStorageProbe(() => Promise.all([
      prisma.compendiumEntry.count({ where: { kind: CompendiumEntryKind.MONSTER, inTypedImport: true } }),
      prisma.compendiumEntry.count({ where: { kind: CompendiumEntryKind.ITEM, inTypedImport: true } }),
      prisma.compendiumEntry.count({ where: { kind: CompendiumEntryKind.SPELL, inTypedImport: true } }),
    ]));
    if (monsters + items + spells === 0) return null;
    return { monsters, items, spells };
  } catch {
    return null;
  }
}

export async function readOverrideEntriesFromPostgres(
  kind: CompendiumStorageKind,
): Promise<Array<OwlbearMonster | OwlbearItem | OwlbearSpell>> {
  const [globalOverrides, typed] = await Promise.all([
    readEntriesByKind(kind, { inGlobalOverride: true }),
    readTypedImportEntriesFromPostgres(kind),
  ]);
  const map = new Map<string, OwlbearMonster | OwlbearItem | OwlbearSpell>();
  for (const entry of [...globalOverrides, ...typed]) {
    if (!entry?.name) continue;
    const withId = entry as { _id?: string; name: string; source?: string };
    const id = withId._id?.trim() || compendiumEntryStorageId(withId.name, withId.source);
    map.set(id, entry);
  }
  return Array.from(map.values());
}

export async function readOverrideEntryByNameFromPostgres(
  kind: CompendiumStorageKind,
  name: string,
): Promise<OwlbearMonster | OwlbearItem | OwlbearSpell | null> {
  const key = entryNameKey(name);
  const rows = await readOverrideEntriesFromPostgres(kind);
  return rows.find((entry) => entryNameKey(entry.name) === key) ?? null;
}

export async function readOverrideEntryByIdFromPostgres(
  kind: CompendiumStorageKind,
  id: string,
): Promise<OwlbearMonster | OwlbearItem | OwlbearSpell | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    const row = await withStorageProbe(() => prisma.compendiumEntry.findUnique({ where: { id } }));
    if (row && PRISMA_TO_KIND[row.kind] === kind) {
      return rowToEntry(kind, row);
    }
  } catch {
    /* fall through */
  }
  const rows = await readOverrideEntriesFromPostgres(kind);
  return rows.find((entry) => slugify(entry.name) === id || entryNameKey(entry.name) === entryNameKey(id)) ?? null;
}

export async function readOverrideCountsFromPostgres(): Promise<{
  monsters: number;
  items: number;
  spells: number;
} | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    const [monsters, items, spells] = await withStorageProbe(() => Promise.all([
      prisma.compendiumEntry.count({
        where: {
          kind: CompendiumEntryKind.MONSTER,
          OR: [{ inGlobalOverride: true }, { inGlobalHomebrew: true }, { inTypedImport: true }],
        },
      }),
      prisma.compendiumEntry.count({
        where: {
          kind: CompendiumEntryKind.ITEM,
          OR: [{ inGlobalOverride: true }, { inGlobalHomebrew: true }, { inTypedImport: true }],
        },
      }),
      prisma.compendiumEntry.count({
        where: {
          kind: CompendiumEntryKind.SPELL,
          OR: [{ inGlobalOverride: true }, { inGlobalHomebrew: true }, { inTypedImport: true }],
        },
      }),
    ]));
    return { monsters, items, spells };
  } catch {
    return null;
  }
}

/** Lightweight imported rows for Books tab tallies (no JSON payloads). */
export async function readImportedNameSourceRowsForBooks(): Promise<{
  monster: Array<{ name: string; source?: string }>;
  item: Array<{ name: string; source?: string }>;
  spell: Array<{ name: string; source?: string }>;
}> {
  const empty = { monster: [], item: [], spell: [] };
  if (isCompendiumStorageUnavailable()) return empty;
  try {
    const rows = await withStorageProbe(() => prisma.compendiumEntry.findMany({
      where: { OR: [{ inTypedImport: true }, { inGlobalOverride: true }] },
      select: { kind: true, name: true, source: true, inTypedImport: true },
    }));
    const byKind = {
      monster: [] as Array<{ name: string; source?: string }>,
      item: [] as Array<{ name: string; source?: string }>,
      spell: [] as Array<{ name: string; source?: string }>,
    };
    for (const row of rows) {
      if (!row.inTypedImport && !row.source?.trim()) continue;
      const kind = PRISMA_TO_KIND[row.kind];
      byKind[kind].push({ name: row.name, source: row.source || undefined });
    }
    return {
      monster: byKind.monster,
      item: byKind.item,
      spell: byKind.spell,
    };
  } catch {
    return empty;
  }
}

export async function collectImportedSourceLabelsFromPostgres(): Promise<BookSourceLabelBuckets> {
  const buckets: BookSourceLabelBuckets = {
    monsterSources: [],
    itemSources: [],
    spellSources: [],
  };
  if (isCompendiumStorageUnavailable()) {
    return buckets;
  }
  try {
    const rows = await withStorageProbe(() => prisma.compendiumEntry.findMany({
      where: {
        OR: [{ inTypedImport: true }, { inGlobalOverride: true }],
      },
      select: { kind: true, source: true },
    }));
    for (const row of rows) {
      const source = row.source?.trim();
      if (!source) continue;
      if (row.kind === CompendiumEntryKind.MONSTER) buckets.monsterSources.push(source);
      else if (row.kind === CompendiumEntryKind.ITEM) buckets.itemSources.push(source);
      else buckets.spellSources.push(source);
    }
  } catch {
    /* ignore */
  }
  return buckets;
}

export async function readBookSourceLabelsFromPostgres(): Promise<BookSourceLabelBuckets | null> {
  const collected = await collectImportedSourceLabelsFromPostgres();
  const count =
    collected.monsterSources.length
    + collected.itemSources.length
    + collected.spellSources.length;
  if (count === 0) return null;
  return collected;
}

async function loadImageMaps(includeImageData: boolean): Promise<{
  images: Record<string, string>;
  imagesData: Record<string, string>;
  entryImages: Record<string, string[]>;
}> {
  const images: Record<string, string> = {};
  const imagesData: Record<string, string> = {};
  const entryImages: Record<string, string[]> = {};

  if (isCompendiumStorageUnavailable()) {
    return { images, imagesData, entryImages };
  }

  const refs = await prisma.compendiumImageRef.findMany();
  for (const ref of refs) images[ref.key] = ref.value;

  if (includeImageData) {
    const blobs = await prisma.compendiumImageBlob.findMany();
    for (const blob of blobs) imagesData[blob.key] = blob.data;
  }

  const histories = await prisma.compendiumEntryImageHistory.findMany();
  for (const history of histories) entryImages[history.entryName] = history.urls;

  return { images, imagesData, entryImages };
}

/** One Postgres round-trip for catalog rebuild (avoids pool exhaustion from parallel findMany). */
async function readRawGlobalDocFromPostgresBulk(
  metaRow: { deleted: string[]; lockedSources: string[]; publishedEntryKeys: string[]; lastUpdated: Date | null } | null,
): Promise<Omit<OwlbearRawGlobalDoc, 'images' | 'imagesData' | 'entryImages'>> {
  const rows = await withStorageProbe(() => prisma.compendiumEntry.findMany({
    orderBy: [{ kind: 'asc' }, { name: 'asc' }],
  }));

  const monsters: OwlbearMonster[] = [];
  const items: OwlbearItem[] = [];
  const spells: OwlbearSpell[] = [];
  const overrideMonsters = new Map<string, OwlbearMonster>();
  const overrideItems = new Map<string, OwlbearItem>();
  const overrideSpells = new Map<string, OwlbearSpell>();

  for (const row of rows) {
    const kind = PRISMA_TO_KIND[row.kind];
    const entry = rowToEntry(kind, row);
    const name = entry.name?.trim();
    if (!name) continue;
    const rowKey = row.id;

    if (row.inGlobalHomebrew) {
      if (kind === 'monster') monsters.push(entry as OwlbearMonster);
      else if (kind === 'item') items.push(entry as OwlbearItem);
      else spells.push(entry as OwlbearSpell);
    }

    if (row.inGlobalOverride && !row.inTypedImport) {
      if (kind === 'monster') overrideMonsters.set(rowKey, entry as OwlbearMonster);
      else if (kind === 'item') overrideItems.set(rowKey, entry as OwlbearItem);
      else overrideSpells.set(rowKey, entry as OwlbearSpell);
    }
  }

  for (const row of rows) {
    if (!row.inTypedImport) continue;
    const kind = PRISMA_TO_KIND[row.kind];
    const entry = rowToEntry(kind, row);
    const name = entry.name?.trim();
    if (!name) continue;
    const rowKey = row.id;
    if (kind === 'monster') overrideMonsters.set(rowKey, entry as OwlbearMonster);
    else if (kind === 'item') overrideItems.set(rowKey, entry as OwlbearItem);
    else overrideSpells.set(rowKey, entry as OwlbearSpell);
  }

  const lastUpdated = metaRow?.lastUpdated?.toISOString() ?? new Date(0).toISOString();

  return {
    _id: 'global',
    monsters,
    items,
    spells,
    overrideMonsters: Array.from(overrideMonsters.values()),
    overrideItems: Array.from(overrideItems.values()),
    overrideSpells: Array.from(overrideSpells.values()),
    deleted: metaRow?.deleted ?? [],
    lockedSources: metaRow?.lockedSources ?? [],
    publishedEntryKeys: metaRow?.publishedEntryKeys ?? [],
    lastUpdated,
  };
}

export async function readRawGlobalDocFromPostgres(
  opts?: { includeImageData?: boolean; skipImageMaps?: boolean },
): Promise<OwlbearRawGlobalDoc | null> {
  if (isCompendiumStorageUnavailable()) return null;
  try {
    const includeImageData = opts?.includeImageData !== false;
    const skipImageMaps = opts?.skipImageMaps === true;
    const meta = await withStorageProbe(() => prisma.compendiumMeta.findUnique({ where: { id: 'global' } }));
    if (!meta) await ensureCompendiumMeta();
    const metaRow = meta ?? await prisma.compendiumMeta.findUnique({ where: { id: 'global' } });

    if (skipImageMaps) {
      const bulk = await readRawGlobalDocFromPostgresBulk(metaRow);
      return normalizeOwlbearRawDoc({
        ...bulk,
        images: {},
        imagesData: {},
        entryImages: {},
      });
    }

    const [monsters, items, spells, overrideMonsters, overrideItems, overrideSpells, imageMaps] =
      await Promise.all([
        readEntriesByKind('monster', { inGlobalHomebrew: true }),
        readEntriesByKind('item', { inGlobalHomebrew: true }),
        readEntriesByKind('spell', { inGlobalHomebrew: true }),
        readOverrideEntriesFromPostgres('monster'),
        readOverrideEntriesFromPostgres('item'),
        readOverrideEntriesFromPostgres('spell'),
        loadImageMaps(includeImageData),
      ]);

    const lastUpdated = metaRow?.lastUpdated?.toISOString() ?? new Date(0).toISOString();

    return normalizeOwlbearRawDoc({
      _id: 'global',
      monsters: monsters as OwlbearMonster[],
      items: items as OwlbearItem[],
      spells: spells as OwlbearSpell[],
      overrideMonsters: overrideMonsters as OwlbearMonster[],
      overrideItems: overrideItems as OwlbearItem[],
      overrideSpells: overrideSpells as OwlbearSpell[],
      deleted: metaRow?.deleted ?? [],
      lockedSources: metaRow?.lockedSources ?? [],
      publishedEntryKeys: metaRow?.publishedEntryKeys ?? [],
      images: includeImageData ? imageMaps.images : {},
      imagesData: includeImageData ? imageMaps.imagesData : {},
      entryImages: includeImageData ? imageMaps.entryImages : {},
      lastUpdated,
    });
  } catch (err) {
    console.warn(
      '[Compendium] Postgres raw global read failed:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export async function readPostgresGlobalVersion(): Promise<string | null> {
  try {
    const meta = await withStorageProbe(() => prisma.compendiumMeta.findUnique({
      where: { id: 'global' },
      select: { lastUpdated: true },
    }));
    return meta?.lastUpdated?.toISOString() ?? null;
  } catch {
    return null;
  }
}

export async function readPostgresEntryImageSlice(
  imageKey: string,
  entryName: string,
): Promise<{
  imageRef: string | null;
  entryHistory: string[];
  lastUpdated: string | null;
} | null> {
  try {
    const [ref, history, meta] = await withStorageProbe(() => Promise.all([
      prisma.compendiumImageRef.findUnique({ where: { key: imageKey } }),
      prisma.compendiumEntryImageHistory.findUnique({ where: { entryName } }),
      prisma.compendiumMeta.findUnique({ where: { id: 'global' }, select: { lastUpdated: true } }),
    ]));
    return {
      imageRef: ref?.value ?? null,
      entryHistory: history?.urls ?? [],
      lastUpdated: meta?.lastUpdated?.toISOString() ?? null,
    };
  } catch {
    return null;
  }
}

export async function readPostgresImageRefKey(key: string): Promise<string | null> {
  try {
    const ref = await withStorageProbe(() => prisma.compendiumImageRef.findUnique({ where: { key } }));
    return ref?.value ?? null;
  } catch {
    return null;
  }
}

export async function readPostgresImageDataKey(key: string): Promise<string | null> {
  try {
    const blob = await withStorageProbe(() => prisma.compendiumImageBlob.findUnique({ where: { key } }));
    return blob?.data ?? null;
  } catch {
    return null;
  }
}

export async function readPostgresEntryImageHistory(entryName: string): Promise<string[]> {
  try {
    const history = await withStorageProbe(() => prisma.compendiumEntryImageHistory.findUnique({
      where: { entryName },
    }));
    return history?.urls ?? [];
  } catch {
    return [];
  }
}

export async function readPostgresGlobalImageRefs(): Promise<{
  images: Record<string, string>;
  entryImages: Record<string, string[]>;
  lastUpdated: string;
} | null> {
  try {
    const [refs, histories, meta] = await withStorageProbe(() => Promise.all([
      prisma.compendiumImageRef.findMany(),
      prisma.compendiumEntryImageHistory.findMany(),
      prisma.compendiumMeta.findUnique({ where: { id: 'global' }, select: { lastUpdated: true } }),
    ]));
    return {
      images: Object.fromEntries(refs.map((ref) => [ref.key, ref.value])),
      entryImages: Object.fromEntries(histories.map((h) => [h.entryName, h.urls])),
      lastUpdated: meta?.lastUpdated?.toISOString() ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

async function syncImageRefs(images: Record<string, string>): Promise<void> {
  const keys = Object.keys(images);
  if (keys.length === 0) return;
  await prisma.$transaction(
    keys.map((key) => prisma.compendiumImageRef.upsert({
      where: { key },
      create: { key, value: images[key]! },
      update: { value: images[key]! },
    })),
  );
}

async function syncImageBlobs(imagesData: Record<string, string>): Promise<void> {
  const keys = Object.keys(imagesData);
  if (keys.length === 0) return;
  const BATCH = 25;
  for (let i = 0; i < keys.length; i += BATCH) {
    const slice = keys.slice(i, i + BATCH);
    await prisma.$transaction(
      slice.map((key) => prisma.compendiumImageBlob.upsert({
        where: { key },
        create: { key, data: imagesData[key]! },
        update: { data: imagesData[key]! },
      })),
    );
  }
}

async function syncEntryImageHistories(entryImages: Record<string, string[]>): Promise<void> {
  const names = Object.keys(entryImages);
  if (names.length === 0) return;
  await prisma.$transaction(
    names.map((entryName) => prisma.compendiumEntryImageHistory.upsert({
      where: { entryName },
      create: { entryName, urls: entryImages[entryName] ?? [] },
      update: { urls: entryImages[entryName] ?? [] },
    })),
  );
}

async function upsertGlobalEntryRow(
  kind: CompendiumStorageKind,
  entry: OwlbearMonster | OwlbearItem | OwlbearSpell,
  flags: {
    isCustom: boolean;
    inGlobalOverride?: boolean;
    inGlobalHomebrew?: boolean;
    inTypedImport?: boolean;
  },
): Promise<void> {
  const existing = await prisma.compendiumEntry.findUnique({ where: { id: slugify(entry.name) } });
  const data = buildUpsertData(kind, entry, {
    isCustom: flags.isCustom,
    inTypedImport: flags.inTypedImport ?? existing?.inTypedImport ?? false,
    inGlobalOverride: flags.inGlobalOverride ?? existing?.inGlobalOverride ?? false,
    inGlobalHomebrew: flags.inGlobalHomebrew ?? existing?.inGlobalHomebrew ?? false,
  });
  await prisma.compendiumEntry.upsert({
    where: { id: data.id },
    create: data,
    update: {
      kind: data.kind,
      name: data.name,
      nameKey: data.nameKey,
      source: data.source,
      payload: data.payload,
      isCustom: data.isCustom,
      originBookName: data.originBookName,
      inTypedImport: data.inTypedImport,
      inGlobalOverride: data.inGlobalOverride,
      inGlobalHomebrew: data.inGlobalHomebrew,
    },
  });
}

export async function persistRawGlobalDocToPostgres(
  raw: OwlbearRawGlobalDoc,
  lastUpdated = new Date(),
): Promise<boolean> {
  try {
    await withStorageProbe(async () => {
      const normalized = normalizeOwlbearRawDoc({
        ...raw,
        lastUpdated: lastUpdated.toISOString(),
      });

      await prisma.compendiumMeta.upsert({
        where: { id: 'global' },
        create: {
          id: 'global',
          deleted: normalized.deleted ?? [],
          lockedSources: normalized.lockedSources ?? [],
          publishedEntryKeys: normalized.publishedEntryKeys ?? [],
          lastUpdated,
        },
        update: {
          deleted: normalized.deleted ?? [],
          lockedSources: normalized.lockedSources ?? [],
          publishedEntryKeys: normalized.publishedEntryKeys ?? [],
          lastUpdated,
        },
      });

      for (const entry of normalized.overrideMonsters ?? []) {
        await upsertGlobalEntryRow('monster', entry, { isCustom: false, inGlobalOverride: true });
      }
      for (const entry of normalized.overrideItems ?? []) {
        await upsertGlobalEntryRow('item', entry, { isCustom: false, inGlobalOverride: true });
      }
      for (const entry of normalized.overrideSpells ?? []) {
        await upsertGlobalEntryRow('spell', entry, { isCustom: false, inGlobalOverride: true });
      }
      for (const entry of normalized.monsters ?? []) {
        await upsertGlobalEntryRow('monster', entry, { isCustom: true, inGlobalHomebrew: true });
      }
      for (const entry of normalized.items ?? []) {
        await upsertGlobalEntryRow('item', entry, { isCustom: true, inGlobalHomebrew: true });
      }
      for (const entry of normalized.spells ?? []) {
        await upsertGlobalEntryRow('spell', entry, { isCustom: true, inGlobalHomebrew: true });
      }

      if (normalized.images) await syncImageRefs(normalized.images);
      if (normalized.imagesData) await syncImageBlobs(normalized.imagesData);
      if (normalized.entryImages) await syncEntryImageHistories(normalized.entryImages);
    });
    return true;
  } catch (err) {
    console.warn(
      '[Compendium] Postgres persist failed:',
      err instanceof Error ? err.message : err,
    );
    return false;
  }
}

export type PostgresImageFieldsPatch = {
  images?: Record<string, string>;
  imagesData?: Record<string, string>;
  entryImages?: Record<string, string[]>;
  unsetImageKeys?: string[];
  unsetImageDataKeys?: string[];
  unsetEntryImageNames?: string[];
};

export async function applyPostgresGlobalImagePatch(patch: PostgresImageFieldsPatch): Promise<boolean> {
  try {
    await withStorageProbe(async () => {
      if (patch.images) await syncImageRefs(patch.images);
      if (patch.imagesData) await syncImageBlobs(patch.imagesData);
      if (patch.entryImages) await syncEntryImageHistories(patch.entryImages);

      if (patch.unsetImageKeys?.length) {
        await prisma.compendiumImageRef.deleteMany({
          where: { key: { in: patch.unsetImageKeys } },
        });
      }
      if (patch.unsetImageDataKeys?.length) {
        await prisma.compendiumImageBlob.deleteMany({
          where: { key: { in: patch.unsetImageDataKeys } },
        });
      }
      if (patch.unsetEntryImageNames?.length) {
        await prisma.compendiumEntryImageHistory.deleteMany({
          where: { entryName: { in: patch.unsetEntryImageNames } },
        });
      }

      await touchCompendiumMeta();
    });
    return true;
  } catch {
    return false;
  }
}

export async function updateCompendiumPolicyFields(patch: {
  lockedSources?: string[];
  publishedEntryKeys?: string[];
  deleted?: string[];
}): Promise<void> {
  await withStorageProbe(async () => {
    await ensureCompendiumMeta();
    await prisma.compendiumMeta.update({
      where: { id: 'global' },
      data: {
        ...(patch.lockedSources ? { lockedSources: patch.lockedSources } : {}),
        ...(patch.publishedEntryKeys ? { publishedEntryKeys: patch.publishedEntryKeys } : {}),
        ...(patch.deleted ? { deleted: patch.deleted } : {}),
        lastUpdated: new Date(),
      },
    });
  });
}

export async function readCompendiumPolicyFields(): Promise<{
  lockedSources: string[];
  publishedEntryKeys: string[];
  deleted: string[];
  lastUpdated: string;
} | null> {
  try {
    const meta = await withStorageProbe(() => prisma.compendiumMeta.findUnique({ where: { id: 'global' } }));
    if (!meta) return null;
    return {
      lockedSources: meta.lockedSources,
      publishedEntryKeys: meta.publishedEntryKeys,
      deleted: meta.deleted,
      lastUpdated: meta.lastUpdated.toISOString(),
    };
  } catch {
    return null;
  }
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

export async function seedBundledCompendiumIfEmpty(): Promise<{ seeded: boolean; counts: { monsters: number; items: number; spells: number } }> {
  const existing = await prisma.compendiumEntry.count();
  if (existing > 0) return { seeded: false, counts: { monsters: 0, items: 0, spells: 0 } };

  const { loadLocalMonsters, loadLocalItems, loadLocalSpells } = await import('./compendiumLocal');
  const monsters = loadLocalMonsters();
  const items = loadLocalItems();
  const spells = loadLocalSpells();

  await upsertTypedImportEntriesBulk(
    'monster',
    monsters.map((entry) => ({ entry, isCustom: false })),
  );
  await upsertTypedImportEntriesBulk(
    'item',
    items.map((entry) => ({ entry, isCustom: false })),
  );
  await upsertTypedImportEntriesBulk(
    'spell',
    spells.map((entry) => ({ entry, isCustom: false })),
  );

  return {
    seeded: true,
    counts: { monsters: monsters.length, items: items.length, spells: spells.length },
  };
}
