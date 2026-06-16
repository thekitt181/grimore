/**
 * Extracts JB2A WebM assets for all spells in spellEffectsCatalog.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import https from 'node:https';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ZIP = process.env.JB2A_ZIP ?? path.join(process.env.TEMP ?? '/tmp', 'grimoire-jb2a-module-0.9.0.zip');
const ZIP_URL = 'https://github.com/Jules-Bens-Aa/JB2A_DnD5e/releases/download/0.9.0/module-0.9.0.zip';
const DEST = path.join(ROOT, 'apps/client/public/jb2a/Library');

async function downloadZip() {
  if (fs.existsSync(ZIP) && fs.statSync(ZIP).size > 1_000_000_000) {
    console.log(`Using cached zip: ${ZIP}`);
    return;
  }
  console.log('Downloading JB2A module (~1.6 GB)...');
  await new Promise((resolve, reject) => {
    https.get(ZIP_URL, (res) => {
      if (res.statusCode === 302 || res.statusCode === 301) {
        https.get(res.headers.location, (r2) => {
          r2.pipe(createWriteStream(ZIP)).on('finish', resolve).on('error', reject);
        }).on('error', reject);
        return;
      }
      res.pipe(createWriteStream(ZIP)).on('finish', resolve).on('error', reject);
    }).on('error', reject);
  });
}

function loadBasenames() {
  const catalogPath = path.join(ROOT, 'apps/client/src/systems/spells/spellEffectsCatalog.ts');
  const src = fs.readFileSync(catalogPath, 'utf8');
  const basenames = new Set();
  for (const m of src.matchAll(/"basename": "([^"]+)"/g)) {
    basenames.add(m[1]);
  }
  return [...basenames];
}

async function main() {
  await downloadZip();

  const { default: AdmZip } = await import('adm-zip').catch(() => {
    console.log('adm-zip not found, using PowerShell extraction...');
    return null;
  });

  const basenames = loadBasenames();
  console.log(`Extracting assets for ${basenames.length} unique JB2A basenames...`);

  if (AdmZip) {
    const zip = new AdmZip(ZIP);
    let count = 0;
    for (const entry of zip.getEntries()) {
      const name = entry.entryName.replace(/\\/g, '/');
      if (!name.endsWith('.webm')) continue;
      const match = basenames.find((b) => name.includes(`${b}_`));
      if (!match) continue;
      const libraryIdx = name.indexOf('Library/');
      if (libraryIdx < 0) continue;
      const rel = name.slice(libraryIdx + 'Library/'.length);
      const out = path.join(DEST, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, entry.getData());
      count++;
      console.log(`  ${rel}`);
    }
    console.log(`Extracted ${count} webm files to ${DEST}`);
    return;
  }

  // Fallback: PowerShell one-liner via existing script pattern
  execSync(`node "${path.join(__dirname, 'fetch-jb2a-spells.ps1')}"`, { stdio: 'inherit', shell: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
