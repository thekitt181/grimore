import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractAc, extractVitals } from '../src/services/ddb/vitalsExtract.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'ddb-raw-elyra.json'), 'utf8'));

/** Expected from DDB sheet (character 158550847 / Elyra Tripp). */
const EXPECTED = { ac: 16, maxHp: 77, hp: 65 };

const vitals = extractVitals(raw);
const ac = extractAc(raw);

console.log('extracted:', { ac, ...vitals });
console.log('expected:', EXPECTED);

const ok =
  ac === EXPECTED.ac
  && vitals.maxHp === EXPECTED.maxHp
  && vitals.hp === EXPECTED.hp;

console.log(ok ? 'OK Elyra vitals match DDB' : 'FAIL Elyra vitals mismatch');
process.exit(ok ? 0 : 1);
