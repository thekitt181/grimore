/**
 * Remove pdfcoffee MPMM + Monstrous Menagerie sources from bundled JSON and MongoDB.
 * One-off maintenance script.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(path.join(ROOT, 'apps/server/package.json'));
const { MongoClient } = require('mongodb');

const PDFCOFFEE_PATTERNS = [
  /pdfcoffee\.com_mordenkainen-presents-monsters-of-the-multiverse-pdf-free/i,
  /pdfcoffee\.com_level-up-monstrous-menagerie-in110421-pdf-free/i,
];

function isPdfCoffeeSource(part) {
  const normalized = String(part ?? '').trim();
  if (!normalized) return false;
  return PDFCOFFEE_PATTERNS.some((rx) => rx.test(normalized));
}

function stripPdfCoffeeFromSource(source) {
  const parts = String(source ?? '')
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = parts.filter((p) => !isPdfCoffeeSource(p));
  return kept.join(', ');
}

function cleanEntry(entry) {
  if (!entry || typeof entry !== 'object') return { action: 'skip' };
  const source = entry.source;
  if (!source || !PDFCOFFEE_PATTERNS.some((rx) => rx.test(String(source)))) {
    return { action: 'keep', entry };
  }
  const nextSource = stripPdfCoffeeFromSource(source);
  if (!nextSource) return { action: 'remove' };
  return { action: 'update', entry: { ...entry, source: nextSource } };
}

function cleanArray(arr) {
  if (!Array.isArray(arr)) return { list: [], removed: 0, updated: 0 };
  const out = [];
  let removed = 0;
  let updated = 0;
  for (const entry of arr) {
    const result = cleanEntry(entry);
    if (result.action === 'remove') removed += 1;
    else if (result.action === 'update') {
      updated += 1;
      out.push(result.entry);
    } else if (result.action === 'keep') out.push(result.entry);
  }
  return { list: out, removed, updated };
}

function cleanBundledJson(relativePath) {
  const filePath = path.join(ROOT, relativePath);
  if (!fs.existsSync(filePath)) {
    console.log(`[skip] ${relativePath} not found`);
    return { removed: 0, updated: 0, before: 0, after: 0 };
  }
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    console.log(`[skip] ${relativePath} is not an array`);
    return { removed: 0, updated: 0, before: 0, after: 0 };
  }
  const before = raw.length;
  const { list, removed, updated } = cleanArray(raw);
  fs.writeFileSync(filePath, JSON.stringify(list, null, 2), 'utf8');
  console.log(`[file] ${relativePath}: ${before} → ${list.length} (${removed} removed, ${updated} source trimmed)`);
  return { removed, updated, before, after: list.length };
}

async function cleanMongo(uri) {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db('owlbear-extension');

  let totalRemoved = 0;
  let totalUpdated = 0;

  const globalCol = db.collection('data');
  const doc = await globalCol.findOne({ _id: 'global' });
  if (doc) {
    const sets = {};
    for (const key of [
      'monsters',
      'overrideMonsters',
      'items',
      'overrideItems',
      'spells',
      'overrideSpells',
    ]) {
      if (!Array.isArray(doc[key])) continue;
      const { list, removed, updated } = cleanArray(doc[key]);
      if (removed || updated) sets[key] = list;
      totalRemoved += removed;
      totalUpdated += updated;
    }
    if (Object.keys(sets).length > 0) {
      sets.lastUpdated = new Date().toISOString();
      await globalCol.updateOne({ _id: 'global' }, { $set: sets });
      console.log(`[mongo] data/global: updated fields ${Object.keys(sets).join(', ')}`);
    } else {
      console.log('[mongo] data/global: no pdfcoffee entries');
    }
  } else {
    console.log('[mongo] data/global: document not found');
  }

  for (const colName of ['monsters', 'items', 'spells']) {
    const col = db.collection(colName);
    const cursor = col.find({
      source: {
        $regex: /pdfcoffee\.com_(mordenkainen-presents-monsters-of-the-multiverse|level-up-monstrous-menagerie)/i,
      },
    });
    const toProcess = await cursor.toArray();
    let colRemoved = 0;
    let colUpdated = 0;
    for (const entry of toProcess) {
      const result = cleanEntry(entry);
      if (result.action === 'remove') {
        await col.deleteOne({ _id: entry._id });
        colRemoved += 1;
      } else if (result.action === 'update') {
        await col.updateOne({ _id: entry._id }, { $set: { source: result.entry.source } });
        colUpdated += 1;
      }
    }
    if (colRemoved || colUpdated) {
      console.log(`[mongo] ${colName}: ${colRemoved} deleted, ${colUpdated} trimmed`);
    }
    totalRemoved += colRemoved;
    totalUpdated += colUpdated;
  }

  await client.close();
  return { totalRemoved, totalUpdated };
}

async function main() {
  console.log('Removing pdfcoffee MPMM + Monstrous Menagerie sources…\n');

  cleanBundledJson('apps/server/data/compendium/monsters.json');
  cleanBundledJson('apps/server/data/compendium/items.json');

  const envPath = path.join(ROOT, 'apps/server/.env');
  let uri = process.env.MONGODB_URI;
  if (!uri && fs.existsSync(envPath)) {
    const envText = fs.readFileSync(envPath, 'utf8');
    const match = envText.match(/^MONGODB_URI=(.+)$/m);
    if (match) uri = match[1].trim();
  }

  if (!uri) {
    console.log('\n[mongo] MONGODB_URI not set — skipped Mongo cleanup');
    return;
  }

  console.log('');
  const { totalRemoved, totalUpdated } = await cleanMongo(uri);
  console.log(`\nDone. Mongo: ${totalRemoved} removed, ${totalUpdated} source fields trimmed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
