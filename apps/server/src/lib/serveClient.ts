import fs from 'fs';
import path from 'path';
import express, { type Express } from 'express';

function resolveClientDist(): string | null {
  const configured = process.env['CLIENT_DIST_PATH']?.trim();
  if (configured && fs.existsSync(configured)) return configured;

  const candidates = [
    path.resolve(process.cwd(), '../client/dist'),
    path.resolve(process.cwd(), 'apps/client/dist'),
    path.resolve(__dirname, '../../../client/dist'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'index.html'))) return dir;
  }
  return null;
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

  console.log(`[Server] Serving client static files from ${dist}`);
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
  return true;
}
