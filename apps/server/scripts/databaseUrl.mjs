/** Migration URL helpers for deploy-db.mjs (mirrors src/lib/databaseUrl.ts). */

function parseSource(raw) {
  const source = raw?.trim() ?? process.env.DATABASE_URL?.trim();
  if (!source) {
    throw new Error('DATABASE_URL is not set');
  }
  try {
    return new URL(source);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
}

function isSupabaseHost(hostname) {
  return hostname.includes('supabase.com') || hostname.includes('supabase.co');
}

/** Supabase requires SSL; missing sslmode often surfaces as P1001 from cloud hosts. */
export function ensureSupabaseSsl(connectionUrl) {
  try {
    const url = new URL(connectionUrl);
    if (!isSupabaseHost(url.hostname)) {
      return connectionUrl;
    }
    if (!url.searchParams.has('sslmode')) {
      url.searchParams.set('sslmode', 'require');
    }
    return url.toString();
  } catch {
    return connectionUrl;
  }
}

/** Supabase session pooler (5432) — reliable for migrate deploy from PaaS hosts. */
export function resolvePoolerSessionDatabaseUrl(raw) {
  const source = raw?.trim() ?? process.env.DATABASE_URL?.trim();
  if (!source) return null;

  let url;
  try {
    url = new URL(source);
  } catch {
    return null;
  }

  if (!url.hostname.includes('pooler.supabase.com')) {
    return null;
  }

  url.port = '5432';
  url.searchParams.delete('pgbouncer');
  url.searchParams.delete('connection_limit');
  url.searchParams.delete('pool_timeout');
  return ensureSupabaseSsl(url.toString());
}

/** Migrations prefer direct Postgres — not the PgBouncer transaction pooler (6543). */
export function resolveMigrationDatabaseUrl(raw) {
  const direct = process.env.DIRECT_URL?.trim();
  if (direct) return ensureSupabaseSsl(direct);

  const url = parseSource(raw);

  if (url.hostname.includes('pooler.supabase.com')) {
    const user = decodeURIComponent(url.username);
    const projectRef = user.startsWith('postgres.') ? user.slice('postgres.'.length) : null;
    if (projectRef) {
      url.hostname = `db.${projectRef}.supabase.co`;
      url.port = '5432';
      url.username = 'postgres';
      url.searchParams.delete('pgbouncer');
      url.searchParams.delete('connection_limit');
      url.searchParams.delete('pool_timeout');
      return ensureSupabaseSsl(url.toString());
    }
  }

  if (url.searchParams.get('pgbouncer') === 'true') {
    url.searchParams.delete('pgbouncer');
  }
  return ensureSupabaseSsl(url.toString());
}

/** True for db.PROJECT_REF.supabase.co (unreachable from many PaaS hosts). */
function isDirectOnlySupabaseHost(connectionUrl) {
  try {
    return /^db\.[^.]+\.supabase\.co$/.test(new URL(connectionUrl).hostname);
  } catch {
    return false;
  }
}

/** On Render/Fly/Railway, skip direct Supabase when a pooler URL is available. */
function filterCloudMigrationCandidates(candidates) {
  const onCloud =
    process.env.RENDER === 'true'
    || process.env.RENDER_SERVICE_ID
    || process.env.FLY_APP_NAME
    || process.env.RAILWAY_ENVIRONMENT;
  if (!onCloud) return candidates;

  const hasPooler = candidates.some((u) => u.includes('pooler.supabase.com'));
  if (!hasPooler) return candidates;

  const filtered = candidates.filter((u) => {
    if (isDirectOnlySupabaseHost(u)) {
      console.warn('[db:deploy] Skipping direct Supabase host on cloud (use pooler URL instead)');
      return false;
    }
    return true;
  });
  return filtered.length > 0 ? filtered : candidates;
}

/**
 * Migration URL order:
 * - Render/cloud: session pooler first; never waste retries on db.*.supabase.co.
 * - Local/dev: direct first (avoids pooler advisory locks edge cases).
 */
export function resolveMigrationUrlCandidates(raw) {
  const seen = new Set();
  const candidates = [];

  const push = (value) => {
    const normalized = value ? ensureSupabaseSsl(value) : null;
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  const pooler = resolvePoolerSessionDatabaseUrl(raw);
  const directMigration = resolveMigrationDatabaseUrl(raw);
  const onCloudHost =
    process.env.RENDER === 'true'
    || process.env.RENDER_SERVICE_ID
    || process.env.FLY_APP_NAME
    || process.env.RAILWAY_ENVIRONMENT;

  if (onCloudHost) {
    push(process.env.DATABASE_POOLER_URL?.trim());
    push(process.env.SUPABASE_POOLER_URL?.trim());
    push(pooler);
    push(process.env.DATABASE_URL?.trim());
    push(process.env.DIRECT_URL?.trim());
    push(directMigration);
    return filterCloudMigrationCandidates(candidates);
  }

  push(process.env.DIRECT_URL?.trim());
  push(directMigration);
  push(pooler);
  push(process.env.DATABASE_URL?.trim());

  if (candidates.length === 0) {
    throw new Error('DATABASE_URL is not set');
  }
  return candidates;
}

export function redactDatabaseUrl(connectionUrl) {
  try {
    const url = new URL(connectionUrl);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return '(invalid url)';
  }
}
