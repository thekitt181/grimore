import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractDarkvisionFt } from '../src/services/ddb/sensesExtract.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function load(name) {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8'));
  return extractDarkvisionFt(raw);
}

const elyra = load('ddb-raw-elyra.json');
const basto = load('ddb-raw-basto.json');

const failures = [];
if (elyra !== 0) failures.push(`Elyra: expected 0, got ${elyra}`);
if (basto !== 60) failures.push(`Basto: expected 60, got ${basto}`);

if (failures.length) {
  console.error('Darkvision tests FAILED:');
  for (const f of failures) console.error('  -', f);
  process.exit(1);
}

console.log('OK darkvision:', { elyra, basto });
