/**
 * Copy Vite client build beside server output for reliable production static serving.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'apps/client/dist');
const dest = path.join(root, 'apps/server/client-dist');

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error('[stage-client-dist] Missing apps/client/dist — run client build first');
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

const assets = fs.readdirSync(path.join(dest, 'assets')).length;
console.log(`[stage-client-dist] Staged ${assets} asset file(s) to apps/server/client-dist`);
