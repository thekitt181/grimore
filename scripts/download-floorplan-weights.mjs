#!/usr/bin/env node
/** Download CubiCasa UNet weights (floorplan-to-3d) into services/floorplan-scan/weights */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'services', 'floorplan-scan', 'weights');

const FILES = [
  {
    name: 'best.safetensors',
    url: 'https://huggingface.co/Yytsi/floorplan-to-3d-walls/resolve/main/best.safetensors',
  },
  {
    name: 'config.yaml',
    url: 'https://huggingface.co/Yytsi/floorplan-to-3d-walls/resolve/main/config.yaml',
  },
];

async function download(url, dest) {
  console.log(`Downloading ${path.basename(dest)}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
  console.log(`  → ${dest} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of FILES) {
    const dest = path.join(outDir, file.name);
    if (fs.existsSync(dest)) {
      console.log(`Skip ${file.name} (already exists)`);
      continue;
    }
    await download(file.url, dest);
  }
  console.log('\nFloorplan weights ready.');
  console.log('Install Python deps: pip install -e services/floorplan-scan');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
