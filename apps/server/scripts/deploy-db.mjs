/**
 * Render / production DB setup: prefer migrations, fall back to db push when the
 * database already has tables (Supabase P3005 — non-empty without migration history).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function run(args) {
  return spawnSync('npx', args, {
    cwd: serverRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
  });
}

function emit(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

const migrate = run(['prisma', 'migrate', 'deploy']);
if (migrate.status === 0) {
  emit(migrate);
  process.exit(0);
}

const output = `${migrate.stdout ?? ''}${migrate.stderr ?? ''}`;
if (output.includes('P3005')) {
  console.warn('[db:deploy] Database not empty — baselining with prisma db push');
  const push = run(['prisma', 'db', 'push', '--skip-generate']);
  emit(push);
  process.exit(push.status ?? 1);
}

emit(migrate);
process.exit(migrate.status ?? 1);
