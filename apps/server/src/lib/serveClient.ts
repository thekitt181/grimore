import fs from 'fs';
import path from 'path';
import express, { type Express } from 'express';

function resolveClientDist(): string | null {
  const configured = process.env['CLIENT_DIST_PATH']?.trim();
  if (configured && fs.existsSync(path.join(configured, 'index.html'))) return configured;

  // Paths relative to compiled server (apps/server/dist/lib/serveClient.js)
  const candidates = [
    path.resolve(__dirname, '../../client-dist'),
    path.resolve(__dirname, '../../../client/dist'),
    path.resolve(process.cwd(), 'apps/client/dist'),
    path.resolve(process.cwd(), '../client/dist'),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
}

function hasAssetBundle(dist: string): boolean {
  const assetsDir = path.join(dist, 'assets');
  return fs.existsSync(assetsDir) && fs.readdirSync(assetsDir).length > 0;
}

/** Warn when index.html references bundles that are missing from disk. */
function verifyIndexAssets(dist: string): void {
  const indexPath = path.join(dist, 'index.html');
  const html = fs.readFileSync(indexPath, 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]!);
  const missing = refs.filter((ref) => !fs.existsSync(path.join(dist, ref.replace(/^\//, '').replace(/\//g, path.sep))));
  if (missing.length > 0) {
    console.error('[Server] index.html references missing assets:', missing.join(', '));
  } else if (refs.length > 0) {
    console.log(`[Server] Verified ${refs.length} client bundle reference(s) in index.html`);
  }
}

/** Serve Vite build + SPA fallback when dist exists or SERVE_CLIENT=1. */
export function mountClientSpa(app: Express): boolean {
  const enabled = process.env['SERVE_CLIENT'] === '1';
  const dist = resolveClientDist();
  if (!dist) {
    if (enabled) {
      console.warn('[Server] SERVE_CLIENT=1 but client dist not found — run pnpm build first');
    }
    return false;
  }

  if (!hasAssetBundle(dist)) {
    console.warn(`[Server] Client dist at ${dist} has no assets/ — rebuild the client`);
  } else {
    verifyIndexAssets(dist);
  }

  console.log(`[Server] Serving client static files from ${dist}`);
  app.use(express.static(dist, {
    index: false,
    maxAge: '1y',
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        return;
      }
      if (filePath.endsWith(`${path.sep}index.html`)) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    // Missing hashed bundles must 404 — never return index.html (breaks MIME types).
    if (req.path.startsWith('/assets/') || path.extname(req.path) !== '') {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    res.set('Cache-Control', 'no-cache');
    res.sendFile(path.join(dist, 'index.html'));
  });
  return true;
}
