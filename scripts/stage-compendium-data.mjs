/**
 * Stage Owlbear compendium JSON beside the server for production fallback when MongoDB is down.
 * Skips if bundled data already exists (committed in repo).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'apps/server/data/compendium');
const required = ['monsters.json', 'items.json', 'spells.json'];

function findSourceDir() {
  const env = process.env['OWLBear_DATA_DIR']?.trim();
  if (env && fs.existsSync(path.join(env, 'monsters.json'))) return env;

  for (const rel of [
    '../owlbear_dnd_extension/src',
    '../../owlbear_dnd_extension/src',
    '../../../owlbear_dnd_extension/src',
  ]) {
    const dir = path.resolve(root, rel);
    if (fs.existsSync(path.join(dir, 'monsters.json'))) return dir;
  }
  return null;
}

const destReady = required.every((f) => fs.existsSync(path.join(dest, f)));
if (destReady) {
  console.log('[stage-compendium-data] Bundled catalog already present — skipping');
  process.exit(0);
}

const source = findSourceDir();
if (!source) {
  console.warn(
    '[stage-compendium-data] No Owlbear source found and bundled catalog missing.',
    'Set OWLBear_DATA_DIR or commit apps/server/data/compendium/*.json',
  );
  process.exit(0);
}

fs.mkdirSync(dest, { recursive: true });
for (const file of required) {
  fs.copyFileSync(path.join(source, file), path.join(dest, file));
}
console.log(`[stage-compendium-data] Copied compendium JSON from ${source} → ${dest}`);
