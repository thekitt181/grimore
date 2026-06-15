import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/** Run prisma migrate deploy without blocking HTTP listen (Render startup). */
export function runMigrationsInBackground(): void {
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
