/**
 * Render sets NODE_ENV=production before `pnpm install`, which skips devDependencies
 * (tsc, vite, etc.). Re-install them before the monorepo build when needed.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const tscBin = join(root, 'node_modules', '.bin', 'tsc');
const viteBin = join(root, 'apps', 'client', 'node_modules', '.bin', 'vite');
const prismaBin = join(root, 'apps', 'server', 'node_modules', '.bin', 'prisma');

const needsDevDeps =
  process.env.RENDER === 'true'
  || (process.env.NODE_ENV === 'production' && (!existsSync(tscBin) || !existsSync(viteBin)));

if (!needsDevDeps) {
  process.exit(0);
}

console.log('[ensure-build-deps] Installing devDependencies for production build…');

const result = spawnSync(
  'pnpm',
  ['install', '--prod=false', '--prefer-offline', '--frozen-lockfile'],
  { stdio: 'inherit', shell: true },
);

process.exit(result.status ?? 1);
