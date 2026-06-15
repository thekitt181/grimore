/**
 * Render / production DB setup:
 * 1. prisma migrate deploy (normal path)
 * 2. Legacy Supabase DB (P3005): rename clerkId → authUserId, then db push
 * 3. Mark migrations applied so future deploys use migrate deploy
 *
 * Usage:
 *   node scripts/deploy-db.mjs            — best-effort (exit 0 if DB unreachable)
 *   node scripts/deploy-db.mjs --required — fail if migrations cannot run (startup)
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  redactDatabaseUrl,
  resolveMigrationUrlCandidates,
} from './databaseUrl.mjs';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(serverRoot, 'prisma', 'migrations');
const required = process.argv.includes('--required');

// Render build still runs db:deploy in many dashboards — skip instantly; startup uses --required.
if (!required && process.env.RENDER === 'true') {
  console.warn('[db:deploy] Skipping migrations during Render build.');
  console.warn('[db:deploy] Migrations run at startup: pnpm start:render');
  console.warn('[db:deploy] Optional: change build command to "pnpm install --frozen-lockfile && pnpm build" only.');
  process.exit(0);
}

const MIGRATION_NAMES = [
  '20250606120000_ddb_integration',
  '20250611120000_ddb_library_import_jobs',
  '20250611190000_better_auth',
  '20250611200000_auth_user_last_active_at',
];

const MAX_ATTEMPTS = required ? 5 : 1;
const RETRY_BASE_MS = 3000;

let migrationCandidates;
try {
  migrationCandidates = resolveMigrationUrlCandidates();
} catch (err) {
  console.error('[db:deploy]', err instanceof Error ? err.message : err);
  process.exit(required ? 1 : 0);
}

console.log(
  `[db:deploy] Mode: ${required ? 'required (startup)' : 'best-effort (build-safe)'}`,
);
console.log(
  `[db:deploy] Migration URL candidates: ${migrationCandidates.map(redactDatabaseUrl).join(' → ')}`,
);

function migrationEnv(databaseUrl) {
  return {
    ...process.env,
    DATABASE_URL: databaseUrl,
  };
}

function isRetryableDbError(output) {
  return (
    output.includes('P1001')
    || output.includes("Can't reach database server")
    || output.includes('P1002')
    || output.includes('timed out')
    || output.includes('ECONNREFUSED')
    || output.includes('ETIMEDOUT')
    || output.includes('ENOTFOUND')
  );
}

function sleep(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    /* wait */
  }
}

function run(args, databaseUrl, options = {}) {
  return spawnSync('npx', args, {
    cwd: serverRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'pipe'],
    env: migrationEnv(databaseUrl),
    ...options,
  });
}

function emit(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function runWithRetries(args, databaseUrl) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    last = run(args, databaseUrl);
    if (last.status === 0) return last;
    const output = `${last.stdout ?? ''}${last.stderr ?? ''}`;
    if (!isRetryableDbError(output) || attempt === MAX_ATTEMPTS) {
      return last;
    }
    const waitMs = RETRY_BASE_MS * attempt;
    console.warn(
      `[db:deploy] Database unreachable (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying in ${waitMs / 1000}s…`,
    );
    sleep(waitMs);
  }
  return last;
}

function runMigrateDeploy() {
  let lastOutput = '';
  for (const databaseUrl of migrationCandidates) {
    console.log(`[db:deploy] Trying ${redactDatabaseUrl(databaseUrl)}`);
    const migrate = runWithRetries(['prisma', 'migrate', 'deploy'], databaseUrl);
    if (migrate.status === 0) {
      emit(migrate);
      return { ok: true, result: migrate, output: '' };
    }
    lastOutput = `${migrate.stdout ?? ''}${migrate.stderr ?? ''}`;
    emit(migrate);
    if (!isRetryableDbError(lastOutput)) {
      return { ok: false, result: migrate, output: lastOutput };
    }
    console.warn('[db:deploy] Candidate unreachable — trying next URL…');
  }
  return { ok: false, result: null, output: lastOutput };
}

function markMigrationsApplied(databaseUrl) {
  for (const name of MIGRATION_NAMES) {
    if (!fs.existsSync(path.join(migrationsDir, name))) continue;
    const resolved = run(['prisma', 'migrate', 'resolve', '--applied', name], databaseUrl);
    emit(resolved);
    if (resolved.status !== 0) {
      console.warn(`[db:deploy] migrate resolve ${name} returned ${resolved.status} (may already be recorded)`);
    }
  }
}

function baselineLegacyDatabase(databaseUrl) {
  const sqlPath = path.join(serverRoot, 'scripts', 'baseline-legacy-auth.sql');
  console.warn('[db:deploy] Legacy database — applying clerkId→authUserId rename + auth tables');

  const exec = run(['prisma', 'db', 'execute', '--file', sqlPath, '--schema', 'prisma/schema.prisma'], databaseUrl);
  emit(exec);
  if (exec.status !== 0) {
    return exec.status ?? 1;
  }

  const push = run(['prisma', 'db', 'push', '--skip-generate'], databaseUrl);
  emit(push);
  if (push.status !== 0) {
    return push.status ?? 1;
  }

  markMigrationsApplied(databaseUrl);

  const verify = runWithRetries(['prisma', 'migrate', 'deploy'], databaseUrl);
  emit(verify);
  return verify.status ?? 0;
}

function exitOnFailure(code, output) {
  if (required) {
    process.exit(code);
  }
  console.warn('[db:deploy] Database unreachable — skipping migrations for this phase.');
  console.warn('[db:deploy] Migrations run at startup via: pnpm start:render');
  console.warn('[db:deploy] Tip: remove db:deploy from the Render build command (use build only).');
  if (output.includes('P1001') || output.includes("Can't reach database server")) {
    console.warn('[db:deploy] Also check Supabase is not paused and DATABASE_URL is correct on Render.');
  }
  process.exit(0);
}

const { ok, output } = runMigrateDeploy();
if (ok) {
  process.exit(0);
}

if (output.includes('P3005') || output.includes('authUserId')) {
  const code = baselineLegacyDatabase(migrationCandidates[0]);
  if (code === 0) {
    process.exit(0);
  }
  exitOnFailure(code, output);
}

exitOnFailure(1, output);
