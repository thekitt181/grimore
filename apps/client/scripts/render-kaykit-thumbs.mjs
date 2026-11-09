import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '..');
const glbDir = path.join(client, 'public/props3d/kaykit');
const outDir = path.join(client, 'public/props/kaykit');
const threeRoot = path.join(client, 'node_modules/three');
const htmlPath = path.join(here, 'kaykit-thumb.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
};

function send(res, file, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/' || url.pathname === '/thumb.html') {
    send(res, htmlPath, MIME['.html']);
    return;
  }
  if (url.pathname === '/vendor/three.module.js') {
    send(res, path.join(threeRoot, 'build/three.module.js'), MIME['.js']);
    return;
  }
  if (url.pathname.startsWith('/vendor/addons/')) {
    const rel = url.pathname.replace('/vendor/addons/', '');
    const file = path.join(threeRoot, 'examples/jsm', rel);
    if (!file.startsWith(path.join(threeRoot, 'examples/jsm')) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    send(res, file, MIME['.js']);
    return;
  }
  if (url.pathname.startsWith('/glb/')) {
    const name = path.basename(url.pathname);
    const file = path.join(glbDir, name);
    if (!file.startsWith(glbDir) || !fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    send(res, file, MIME['.glb']);
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const require = createRequire(import.meta.url);
let puppeteer;
const candidates = [
  path.join(here, 'node_modules/puppeteer-core'),
  path.join(process.env.TEMP ?? '/tmp', 'grimoire-puppeteer/node_modules/puppeteer-core'),
];
for (const dir of candidates) {
  try {
    puppeteer = require(path.join(dir, 'lib/esm/puppeteer/puppeteer-core.js'));
    break;
  } catch {
    try {
      puppeteer = require(dir);
      break;
    } catch {
      /* next */
    }
  }
}
if (!puppeteer) {
  const vendor = path.join(process.env.TEMP ?? '/tmp', 'grimoire-puppeteer');
  fs.mkdirSync(vendor, { recursive: true });
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync('npm', ['install', '--no-save', 'puppeteer-core@24'], {
    cwd: vendor,
    stdio: 'inherit',
    shell: true,
  });
  if (r.status !== 0) {
    server.close();
    process.exit(1);
  }
  puppeteer = require(path.join(vendor, 'node_modules/puppeteer-core'));
}

const edge =
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const executablePath = fs.existsSync(edge) ? edge : chrome;

const browser = await puppeteer.launch({
  executablePath,
  headless: true,
  args: ['--allow-file-access-from-files', '--disable-gpu-sandbox'],
});

fs.mkdirSync(outDir, { recursive: true });
const only = process.argv.slice(2);
const glbs = fs
  .readdirSync(glbDir)
  .filter((f) => f.endsWith('.glb'))
  .filter((f) => only.length === 0 || only.includes(f.replace(/\.glb$/i, '')))
  .sort();
const page = await browser.newPage();
await page.setViewport({ width: 256, height: 256, deviceScaleFactor: 1 });

let ok = 0;
for (const glb of glbs) {
  const src = `/glb/${encodeURIComponent(glb)}`;
  await page.goto(`${origin}/thumb.html?src=${src}&n=${encodeURIComponent(glb)}`, {
    waitUntil: 'load',
    timeout: 30000,
  });
  await page.waitForFunction(
    (name) => window.__ready === true && window.__png && location.search.includes(name),
    { timeout: 20000 },
    encodeURIComponent(glb),
  );
  const err = await page.evaluate(() => window.__error);
  if (err) {
    console.error('FAIL', glb, err);
    continue;
  }
  const png = await page.evaluate(() => window.__png);
  const stem = glb.replace(/\.glb$/i, '');
  const buf = Buffer.from(png.split(',')[1], 'base64');
  fs.writeFileSync(path.join(outDir, `${stem}.png`), buf);
  ok += 1;
  console.log('ok', stem);
}

await browser.close();
server.close();
console.log('wrote', ok, '/', glbs.length, 'to', outDir);
