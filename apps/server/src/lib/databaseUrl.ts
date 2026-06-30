/** Runtime Postgres URL with safe pool settings (Supabase-friendly). */
function isRenderDeploy(): boolean {
  return process.env['RENDER'] === 'true' || Boolean(process.env['RENDER_SERVICE_ID']);
}

function withSupabaseSsl(connectionUrl: string): string {
  try {
    const url = new URL(connectionUrl);
    if (url.hostname.includes('supabase.com') || url.hostname.includes('supabase.co')) {
      if (!url.searchParams.has('sslmode')) {
        url.searchParams.set('sslmode', 'require');
      }
    }
    return url.toString();
  } catch {
    return connectionUrl;
  }
}

export function resolveDatabaseUrl(raw?: string): string {
  const source = raw?.trim() ?? process.env['DATABASE_URL']?.trim();
  if (!source) {
    throw new Error('DATABASE_URL is not set');
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

  // Prisma + Supabase: the session pooler (5432) caps at ~15 clients, so always route the
  // app through the transaction pooler (6543), which multiplexes and isn't capped that low.
  // Force it whenever the host is the Supabase pooler and the port isn't already 6543
  // (covers URLs that omit the port and would otherwise default to session mode).
  if (url.hostname.includes('pooler.supabase.com') && url.port !== '6543') {
    url.port = '6543';
    if (!url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
  }

  if (!url.searchParams.has('connection_limit')) {
    const fromEnv = process.env['DATABASE_CONNECTION_LIMIT']?.trim();
    // Render: 2 slots so a slow background query cannot block auth/API (limit=1 caused P2024).
    const fallback = isRenderDeploy() ? '2' : '4';
    url.searchParams.set('connection_limit', fromEnv || fallback);
  }

  if (!url.searchParams.has('connect_timeout')) {
    const fromEnv = process.env['DATABASE_CONNECT_TIMEOUT']?.trim();
    url.searchParams.set('connect_timeout', fromEnv || '10');
  }

  if (!url.searchParams.has('pool_timeout')) {
    const fromEnv = process.env['DATABASE_POOL_TIMEOUT']?.trim();
    url.searchParams.set('pool_timeout', fromEnv || (isRenderDeploy() ? '10' : '20'));
  }

  return withSupabaseSsl(url.toString());
}

/** Dedicated Prisma pool for Better Auth — separate slot so OAuth is not queued behind compendium. */
export function resolveAuthDatabaseUrl(): string {
  const base = resolveDatabaseUrl();
  try {
    const url = new URL(base);
    const fromEnv = process.env['AUTH_DATABASE_CONNECTION_LIMIT']?.trim();
    url.searchParams.set('connection_limit', fromEnv || '1');
    return withSupabaseSsl(url.toString());
  } catch {
    return base;
  }
}

/** @deprecated Same URL as resolveDatabaseUrl — kept for callers/tests. */
export function resolveReadDatabaseUrl(): string {
  return resolveDatabaseUrl();
}

/** Prisma migrate needs direct Postgres — not the PgBouncer transaction pooler. */
export function resolveMigrationDatabaseUrl(raw?: string): string {
  const direct = process.env['DIRECT_URL']?.trim();
  if (direct) return withSupabaseSsl(direct);

  const source = raw?.trim() ?? process.env['DATABASE_URL']?.trim();
  if (!source) {
    throw new Error('DATABASE_URL is not set');
  }

  let url: URL;
  try {
    url = new URL(source);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }

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
      return withSupabaseSsl(url.toString());
    }
  }

  if (url.searchParams.get('pgbouncer') === 'true') {
    url.searchParams.delete('pgbouncer');
  }
  return withSupabaseSsl(url.toString());
}
