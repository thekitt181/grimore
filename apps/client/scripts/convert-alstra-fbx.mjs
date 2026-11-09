import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const client = path.resolve(here, '..');
const alstra = path.join(client, 'public/props3d/alstra');
const threeRoot = path.join(client, 'node_modules/three');
const htmlPath = path.join(here, 'fbx-to-glb.html');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.fbx': 'application/octet-stream',
  '.png': 'image/png',
};

function send(res, file, type) {
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (url.pathname === '/' || url.pathname === '/convert.html') {
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
  if (url.pathname.startsWith('/alstra/')) {
    const name = path.basename(url.pathname);
    const file = path.join(alstra, name);
    if (!fs.existsSync(file)) {
      res.writeHead(404);
      res.end();
      return;
    }
    send(res, file, MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream');
    return;
  }
  res.writeHead(404);
  res.end();
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;

const require = createRequire(import.meta.url);
const vendor = path.join(process.env.TEMP ?? '/tmp', 'grimoire-puppeteer');
let puppeteer;
try {
  puppeteer = require(path.join(vendor, 'node_modules/puppeteer-core'));
} catch {
  throw new Error('puppeteer-core missing');
}

const edge = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ['--allow-file-access-from-files'],
});
const page = await browser.newPage();
page.setDefaultTimeout(60000);

const fbxs = fs.readdirSync(alstra).filter((f) => f.toLowerCase().endsWith('.fbx')).sort();
for (const fbx of fbxs) {
  const src = `/alstra/${encodeURIComponent(fbx)}`;
  await page.goto(`${origin}/convert.html?src=${src}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ready === true, { timeout: 45000 });
  const err = await page.evaluate(() => window.__error);
  const info = await page.evaluate(() => window.__info);
  if (err) {
    console.error('FAIL', fbx, err, info);
    continue;
  }
  console.log(fbx, info);
  const b64 = await page.evaluate(() => window.__glb);
  const out = path.join(alstra, fbx.replace(/\.fbx$/i, '.glb'));
  fs.writeFileSync(out, Buffer.from(b64, 'base64'));
  console.log('ok', fbx, fs.statSync(out).size);
}

await browser.close();
server.close();
