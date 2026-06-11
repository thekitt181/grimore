/**
 * Render / production DB setup:
 * 1. prisma migrate deploy (normal path)
 * 2. Legacy Supabase DB (P3005): rename clerkId → authUserId, then db push
 * 3. Mark migrations applied so future deploys use migrate deploy
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(serverRoot, 'prisma', 'migrations');

const MIGRATION_NAMES = [
  '20250606120000_ddb_integration',
  '20250611120000_ddb_library_import_jobs',
  '20250611190000_better_auth',
];

function run(args, options = {}) {
  return spawnSync('npx', args, {
    cwd: serverRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    ...options,
  });
}

function emit(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function markMigrationsApplied() {
  for (const name of MIGRATION_NAMES) {
    if (!fs.existsSync(path.join(migrationsDir, name))) continue;
    const resolved = run(['prisma', 'migrate', 'resolve', '--applied', name]);
    emit(resolved);
    if (resolved.status !== 0) {
      console.warn(`[db:deploy] migrate resolve ${name} returned ${resolved.status} (may already be recorded)`);
    }
  }
}

function baselineLegacyDatabase() {
  const sqlPath = path.join(serverRoot, 'scripts', 'baseline-legacy-auth.sql');
  console.warn('[db:deploy] Legacy database — applying clerkId→authUserId rename + auth tables');

  const exec = run(['prisma', 'db', 'execute', '--file', sqlPath, '--schema', 'prisma/schema.prisma']);
  emit(exec);
  if (exec.status !== 0) {
    return exec.status ?? 1;
  }

  const push = run(['prisma', 'db', 'push', '--skip-generate']);
  emit(push);
  if (push.status !== 0) {
    return push.status ?? 1;
  }

  markMigrationsApplied();

  const verify = run(['prisma', 'migrate', 'deploy']);
  emit(verify);
  return verify.status ?? 0;
}

const migrate = run(['prisma', 'migrate', 'deploy']);
if (migrate.status === 0) {
  emit(migrate);
  process.exit(0);
}

const output = `${migrate.stdout ?? ''}${migrate.stderr ?? ''}`;

if (output.includes('P3005') || output.includes('authUserId')) {
  const code = baselineLegacyDatabase();
  process.exit(code);
}

emit(migrate);
process.exit(migrate.status ?? 1);
