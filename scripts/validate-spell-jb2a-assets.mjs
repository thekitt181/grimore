/**
 * Validates spellEffectsCatalog JB2A paths against apps/client/public/jb2a/Library.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIB = path.join(ROOT, 'apps/client/public/jb2a/Library');
const CATALOG = path.join(ROOT, 'apps/client/src/systems/spells/spellEffectsCatalog.ts');

const catalogSrc = fs.readFileSync(CATALOG, 'utf8');
const entries = [...catalogSrc.matchAll(/"id":\s*"([^"]+)"[\s\S]*?"name":\s*"([^"]+)"[\s\S]*?"basename":\s*"([^"]+)"[\s\S]*?"suffix":\s*"([^"]+)"/g)]
  .map((m) => ({ id: m[1], name: m[2], basename: m[3], suffix: m[4] }));

const webmFiles = new Set();
for (const file of fs.readdirSync(LIB, { recursive: true })) {
  if (typeof file === 'string' && file.endsWith('.webm')) {
    webmFiles.add(file.replace(/\\/g, '/'));
  }
}

function resolveUrl(basename, suffix) {
  return `${basename}_${suffix}.webm`;
}

const missing = [];
const ok = [];

for (const e of entries) {
  const rel = resolveUrl(e.basename, e.suffix);
  if (webmFiles.has(rel)) {
    ok.push(e);
    continue;
  }
  // Try fuzzy: any file starting with basename_ and containing suffix core
  const prefix = `${e.basename}_`;
  const candidates = [...webmFiles].filter((f) => f.startsWith(prefix));
  missing.push({ ...e, rel, candidates: candidates.slice(0, 5) });
}

console.log(`Catalog spells: ${entries.length}`);
console.log(`OK: ${ok.length}`);
console.log(`MISSING: ${missing.length}\n`);

for (const m of missing) {
  console.log(`✗ ${m.name} (${m.id})`);
  console.log(`  expected: ${m.rel}`);
  if (m.candidates.length) {
    console.log(`  similar:  ${m.candidates.join('\n            ')}`);
  } else {
    const dir = m.basename.split('/').slice(0, -1).join('/');
    const dirFiles = [...webmFiles].filter((f) => f.startsWith(dir + '/')).slice(0, 3);
    if (dirFiles.length) console.log(`  in dir:   ${dirFiles.join('\n            ')}`);
  }
  console.log('');
}

process.exit(missing.length > 0 ? 1 : 0);
