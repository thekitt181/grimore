/**
 * One-time import: Owlbear extension JSON → MongoDB collections.
 * Preserves existing data.global custom entries.
 *
 * Usage: pnpm import:compendium [--force]
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';
import type { OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
import { isLikelyValidItem, slugify } from '@grimoire/monster-dex';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_NAME = 'owlbear-extension';
const force = process.argv.includes('--force');

function dataDir(): string {
  const env = process.env['OWLBear_DATA_DIR'];
  if (env && fs.existsSync(env)) return env;
  const sibling = path.resolve(__dirname, '../../../../owlbear_dnd_extension/src');
  if (fs.existsSync(sibling)) return sibling;
  throw new Error('Owlbear data not found. Set OWLBear_DATA_DIR to owlbear_dnd_extension/src');
}

function uniqueSlug(name: string, used: Set<string>): string {
  let base = slugify(name);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const id = `${base}-${n}`;
  used.add(id);
  return id;
}

async function main() {
  const uri = process.env['MONGODB_URI'];
  if (!uri) {
    console.error('MONGODB_URI is required');
    process.exit(1);
  }

  const dir = dataDir();
  console.log('[Import] Reading from', dir);

  const monstersRaw = JSON.parse(fs.readFileSync(path.join(dir, 'monsters.json'), 'utf8')) as OwlbearMonster[];
  const itemsRaw = JSON.parse(fs.readFileSync(path.join(dir, 'items.json'), 'utf8')) as OwlbearItem[];
  const spellsRaw = JSON.parse(fs.readFileSync(path.join(dir, 'spells.json'), 'utf8')) as Record<string, Omit<OwlbearSpell, 'name'>>;

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(DB_NAME);

  if (force) {
    await db.collection('monsters').deleteMany({});
    await db.collection('items').deleteMany({});
    await db.collection('spells').deleteMany({});
    console.log('[Import] Cleared base collections');
  }

  const existingGlobal = await db.collection('data').findOne({ _id: 'global' });
  const globalDoc = existingGlobal ?? {
    _id: 'global',
    monsters: [],
    items: [],
    spells: [],
    deleted: [],
    images: {},
    imagesData: {},
    lastUpdated: new Date(0),
  };

  const monsterSlugs = new Set<string>();
  const monsterOps = monstersRaw.map((m) => {
    const _id = uniqueSlug(m.name, monsterSlugs);
    return {
      updateOne: {
        filter: { _id },
        update: { $set: { ...m, _id, isCustom: false } },
        upsert: true,
      },
    };
  });

  const itemSlugs = new Set<string>();
  const validItems = itemsRaw.filter(isLikelyValidItem);
  console.log(`[Import] Items: ${validItems.length} valid / ${itemsRaw.length} total`);
  const itemOps = validItems.map((i) => {
    const _id = uniqueSlug(i.name, itemSlugs);
    return {
      updateOne: {
        filter: { _id },
        update: { $set: { ...i, _id, isCustom: false } },
        upsert: true,
      },
    };
  });

  const spellSlugs = new Set<string>();
  const spellOps = Object.entries(spellsRaw).map(([key, val]) => {
    const name = key.replace(/\b\w/g, (c) => c.toUpperCase());
    const _id = uniqueSlug(key, spellSlugs);
    const spell: OwlbearSpell = { name, level: val.level, ...val };
    return {
      updateOne: {
        filter: { _id },
        update: { $set: { ...spell, _id, isCustom: false } },
        upsert: true,
      },
    };
  });

  if (monsterOps.length) await db.collection('monsters').bulkWrite(monsterOps, { ordered: false });
  if (itemOps.length) await db.collection('items').bulkWrite(itemOps, { ordered: false });
  if (spellOps.length) await db.collection('spells').bulkWrite(spellOps, { ordered: false });

  await db.collection('monsters').createIndex({ name: 'text' });
  await db.collection('items').createIndex({ name: 'text' });
  await db.collection('spells').createIndex({ name: 'text' });

  await db.collection('data').updateOne(
    { _id: 'global' },
    {
      $setOnInsert: globalDoc,
      $set: { lastUpdated: globalDoc.lastUpdated ?? new Date() },
    },
    { upsert: true },
  );

  const mc = await db.collection('monsters').countDocuments();
  const ic = await db.collection('items').countDocuments();
  const sc = await db.collection('spells').countDocuments();
  console.log(`[Import] Done — monsters: ${mc}, items: ${ic}, spells: ${sc}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
