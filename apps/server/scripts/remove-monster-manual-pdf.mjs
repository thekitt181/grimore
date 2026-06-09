import 'dotenv/config';
import fs from 'fs';
import dns from 'node:dns';
import { MongoClient } from 'mongodb';

dns.setServers(['8.8.8.8', '1.1.1.1', ...dns.getServers()]);

/** PDF-scrape source shown in UI as "Monster Manual" (79 entries in src catalog). */
function matchesMonsterManualPdf(source) {
  if (!source) return false;
  return String(source).toLowerCase().includes('monster_manual');
}

function filterList(list) {
  if (!Array.isArray(list)) return { kept: list, removed: [] };
  const kept = [];
  const removed = [];
  for (const entry of list) {
    if (matchesMonsterManualPdf(entry?.source)) removed.push(entry);
    else kept.push(entry);
  }
  return { kept, removed };
}

function cleanMonsterFiles() {
  const paths = [
    'c:/Users/Admin/Desktop/owlbear_dnd_extension/src/monsters.json',
    'c:/Users/Admin/Desktop/owlbear_dnd_extension/monsters.json',
  ];
  const summary = [];
  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue;
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!Array.isArray(raw)) continue;
    const kept = raw.filter((m) => !matchesMonsterManualPdf(m.source));
    const removed = raw.length - kept.length;
    if (removed > 0) {
      fs.copyFileSync(filePath, `${filePath}.bak-before-mm-pdf-removal`);
      fs.writeFileSync(filePath, JSON.stringify(kept, null, 2));
    }
    summary.push({ filePath, before: raw.length, after: kept.length, removed });
  }
  return summary;
}

function cleanDataJson() {
  const filePath = 'c:/Users/Admin/Desktop/owlbear_dnd_extension/server/data.json';
  if (!fs.existsSync(filePath)) return null;
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  let removedTotal = 0;
  for (const field of ['monsters', 'overrideMonsters', 'items', 'overrideItems', 'spells', 'overrideSpells']) {
    if (!Array.isArray(raw[field])) continue;
    const { kept, removed } = filterList(raw[field]);
    removedTotal += removed.length;
    raw[field] = kept;
  }
  if (removedTotal > 0) {
    fs.copyFileSync(filePath, `${filePath}.bak-before-mm-pdf-removal`);
    raw.lastUpdated = new Date().toISOString();
    fs.writeFileSync(filePath, JSON.stringify(raw, null, 2));
  }
  return { filePath, removedTotal };
}

async function cleanMongo() {
  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db('owlbear-extension');
  const summary = { global: {}, monstersCollection: 0 };

  const dataCol = db.collection('data');
  const global = await dataCol.findOne({ _id: 'global' });
  if (global) {
    const next = { ...global };
    let removedTotal = 0;
    for (const field of [
      'monsters',
      'overrideMonsters',
      'items',
      'overrideItems',
      'spells',
      'overrideSpells',
      'extractedMonsters',
    ]) {
      if (!Array.isArray(next[field])) continue;
      const { kept, removed } = filterList(next[field]);
      summary.global[field] = { before: next[field].length, removed: removed.length, after: kept.length };
      removedTotal += removed.length;
      next[field] = kept;
    }
    if (removedTotal > 0) {
      next.lastUpdated = new Date().toISOString();
      await dataCol.updateOne({ _id: 'global' }, { $set: next });
    }
    summary.global.removedTotal = removedTotal;
  }

  const monstersCol = db.collection('monsters');
  const all = await monstersCol.find({}, { projection: { source: 1, name: 1 } }).toArray();
  const ids = all.filter((m) => matchesMonsterManualPdf(m.source)).map((m) => m._id);
  if (ids.length) {
    const res = await monstersCol.deleteMany({ _id: { $in: ids } });
    summary.monstersCollection = res.deletedCount || 0;
  }

  await client.close();
  return summary;
}

const files = cleanMonsterFiles();
const dataJson = cleanDataJson();
const mongo = await cleanMongo();

console.log(JSON.stringify({ files, dataJson, mongo }, null, 2));
console.log('Done. Restart the Grimoire server to refresh the compendium cache.');
