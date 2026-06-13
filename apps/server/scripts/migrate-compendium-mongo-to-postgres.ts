/**
 * One-time migration: MongoDB owlbear-extension → Supabase Postgres compendium tables.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... MONGODB_URI=mongodb+srv://... pnpm --filter @grimoire/server migrate:compendium
 */
import 'dotenv/config';
import { MongoClient } from 'mongodb';
import { CompendiumEntryKind } from '@prisma/client';
import { slugify } from '@grimoire/monster-dex';
import { prisma } from '../src/lib/prisma';
import type { OwlbearItem, OwlbearMonster, OwlbearRawGlobalDoc, OwlbearSpell } from '@grimoire/shared';
import { entryNameKey } from '../src/services/compendiumMerge';

const DB_NAME = 'owlbear-extension';

type Entry = OwlbearMonster | OwlbearItem | OwlbearSpell;

function kindEnum(kind: 'monster' | 'item' | 'spell'): CompendiumEntryKind {
  if (kind === 'monster') return CompendiumEntryKind.MONSTER;
  if (kind === 'item') return CompendiumEntryKind.ITEM;
  return CompendiumEntryKind.SPELL;
}

async function upsertEntry(
  kind: 'monster' | 'item' | 'spell',
  entry: Entry,
  flags: {
    isCustom: boolean;
    inTypedImport?: boolean;
    inGlobalOverride?: boolean;
    inGlobalHomebrew?: boolean;
  },
) {
  const id = slugify(entry.name);
  const existing = await prisma.compendiumEntry.findUnique({ where: { id } });
  await prisma.compendiumEntry.upsert({
    where: { id },
    create: {
      id,
      kind: kindEnum(kind),
      name: entry.name,
      nameKey: entryNameKey(entry.name),
      source: entry.source?.trim() || (flags.isCustom ? 'Custom' : ''),
      payload: entry as object,
      isCustom: flags.isCustom,
      originBookName: 'originBookName' in entry ? (entry.originBookName as string | undefined) ?? null : null,
      inTypedImport: flags.inTypedImport ?? false,
      inGlobalOverride: flags.inGlobalOverride ?? false,
      inGlobalHomebrew: flags.inGlobalHomebrew ?? false,
    },
    update: {
      kind: kindEnum(kind),
      name: entry.name,
      nameKey: entryNameKey(entry.name),
      source: entry.source?.trim() || (flags.isCustom ? 'Custom' : ''),
      payload: entry as object,
      isCustom: flags.isCustom,
      originBookName: 'originBookName' in entry ? (entry.originBookName as string | undefined) ?? null : null,
      inTypedImport: flags.inTypedImport ?? existing?.inTypedImport ?? false,
      inGlobalOverride: flags.inGlobalOverride ?? existing?.inGlobalOverride ?? false,
      inGlobalHomebrew: flags.inGlobalHomebrew ?? existing?.inGlobalHomebrew ?? false,
    },
  });
}

async function migrateTypedCollection(
  client: MongoClient,
  kind: 'monster' | 'item' | 'spell',
  collection: string,
) {
  const col = client.db(DB_NAME).collection(collection);
  const cursor = col.find({});
  let count = 0;
  for await (const doc of cursor) {
    const entry = doc as Entry & { isCustom?: boolean };
    if (!entry.name?.trim()) continue;
    await upsertEntry(kind, entry, {
      isCustom: Boolean(entry.isCustom),
      inTypedImport: true,
      inGlobalOverride: !entry.isCustom,
      inGlobalHomebrew: Boolean(entry.isCustom),
    });
    count += 1;
  }
  console.log(`[migrate] ${collection}: ${count} entries`);
}

async function migrateGlobalDoc(client: MongoClient) {
  const col = client.db(DB_NAME).collection<OwlbearRawGlobalDoc>('data');
  const doc = await col.findOne({ _id: 'global' });
  if (!doc) {
    console.log('[migrate] no global doc — skipped meta/images');
    return;
  }

  await prisma.compendiumMeta.upsert({
    where: { id: 'global' },
    create: {
      id: 'global',
      deleted: doc.deleted ?? [],
      lockedSources: doc.lockedSources ?? [],
      publishedEntryKeys: doc.publishedEntryKeys ?? [],
      lastUpdated: doc.lastUpdated ? new Date(doc.lastUpdated as string | Date) : new Date(),
    },
    update: {
      deleted: doc.deleted ?? [],
      lockedSources: doc.lockedSources ?? [],
      publishedEntryKeys: doc.publishedEntryKeys ?? [],
      lastUpdated: doc.lastUpdated ? new Date(doc.lastUpdated as string | Date) : new Date(),
    },
  });

  const pairs: Array<['monster' | 'item' | 'spell', Entry[] | undefined, 'override' | 'homebrew']> = [
    ['monster', doc.overrideMonsters, 'override'],
    ['item', doc.overrideItems, 'override'],
    ['spell', doc.overrideSpells, 'override'],
    ['monster', doc.monsters, 'homebrew'],
    ['item', doc.items, 'homebrew'],
    ['spell', doc.spells, 'homebrew'],
  ];

  for (const [kind, list, role] of pairs) {
    for (const entry of list ?? []) {
      if (!entry?.name?.trim()) continue;
      await upsertEntry(kind, entry, {
        isCustom: role === 'homebrew',
        inGlobalOverride: role === 'override',
        inGlobalHomebrew: role === 'homebrew',
      });
    }
  }

  for (const [key, value] of Object.entries(doc.images ?? {})) {
    await prisma.compendiumImageRef.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }

  const blobKeys = Object.keys(doc.imagesData ?? {});
  for (let i = 0; i < blobKeys.length; i += 25) {
    const slice = blobKeys.slice(i, i + 25);
    await prisma.$transaction(
      slice.map((key) => prisma.compendiumImageBlob.upsert({
        where: { key },
        create: { key, data: doc.imagesData![key]! },
        update: { data: doc.imagesData![key]! },
      })),
    );
    console.log(`[migrate] imagesData batch ${i + slice.length}/${blobKeys.length}`);
  }

  for (const [entryName, urls] of Object.entries(doc.entryImages ?? {})) {
    await prisma.compendiumEntryImageHistory.upsert({
      where: { entryName },
      create: { entryName, urls },
      update: { urls },
    });
  }

  console.log('[migrate] global doc meta, overrides, homebrew, and images copied');
}

async function main() {
  const uri = process.env['MONGODB_URI'];
  if (!uri) {
    console.error('MONGODB_URI is required to migrate existing Mongo compendium data');
    process.exit(1);
  }

  await prisma.$connect();
  const client = new MongoClient(uri);
  await client.connect();

  try {
    await migrateTypedCollection(client, 'monster', 'monsters');
    await migrateTypedCollection(client, 'item', 'items');
    await migrateTypedCollection(client, 'spell', 'spells');
    await migrateGlobalDoc(client);

    const [entries, images, blobs] = await Promise.all([
      prisma.compendiumEntry.count(),
      prisma.compendiumImageRef.count(),
      prisma.compendiumImageBlob.count(),
    ]);
    console.log(`[migrate] done — ${entries} entries, ${images} image refs, ${blobs} image blobs in Postgres`);
  } finally {
    await client.close();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
