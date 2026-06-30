import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAc, extractVitals } from '../src/services/ddb/vitalsExtract.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'ddb-raw-basto.json'), 'utf8'));

/** Expected from DDB PDF export (character 161107865 / Basto). */
const EXPECTED = { ac: 19, maxHp: 105, hp: 92 };

const vitals = extractVitals(raw);
const ac = extractAc(raw);

console.log('extracted:', { ac, ...vitals });
console.log('expected:', EXPECTED);
console.log('removedHitPoints:', raw.removedHitPoints);

const ok =
  ac === EXPECTED.ac
  && vitals.maxHp === EXPECTED.maxHp
  && vitals.hp === EXPECTED.hp;

console.log(ok ? 'OK Basto vitals match PDF' : 'FAIL Basto vitals mismatch');
process.exit(ok ? 0 : 1);
