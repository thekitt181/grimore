import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Run prisma migrate deploy without blocking HTTP listen (Render startup). */
export function runMigrationsInBackground(): void {
  if (process.env['SKIP_BACKGROUND_MIGRATIONS'] === '1') {
    console.log('[DB] Skipping background migrations (already ran at process start)');
    return;
  }

  // start:render runs deploy-db synchronously before node dist/index.js on Render.
  if (process.env.RENDER === 'true' || process.env.RENDER_SERVICE_ID) {
    console.log('[DB] Skipping background migrations on Render (start:render already ran deploy-db)');
    return;
  }

  const serverRoot = path.resolve(__dirname, '..', '..');
  const script = path.join(serverRoot, 'scripts', 'deploy-db.mjs');
  if (!fs.existsSync(script)) {
    console.warn('[DB] deploy-db.mjs not found — skipping background migrations');
    return;
  }

  console.log('[DB] Running migrations in background…');
  const child = spawn(process.execPath, [script, '--required'], {
    cwd: serverRoot,
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', (code) => {
    if (code === 0) {
      console.log('[DB] Background migrations finished');
      return;
    }
    console.warn(`[DB] Background migrations exited with code ${code ?? 'unknown'}`);
  });
}
