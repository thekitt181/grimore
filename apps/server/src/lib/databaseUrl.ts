/** Runtime Postgres URL with safe pool settings (Supabase-friendly). */
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

  // Prisma + Supabase: session pooler (5432) caps at ~15 clients — use transaction pooler for the app.
  if (url.hostname.includes('pooler.supabase.com') && url.port === '5432') {
    url.port = '6543';
    if (!url.searchParams.has('pgbouncer')) {
      url.searchParams.set('pgbouncer', 'true');
    }
  }

  if (!url.searchParams.has('connection_limit')) {
    const fromEnv = process.env['DATABASE_CONNECTION_LIMIT']?.trim();
    const fallback = process.env['NODE_ENV'] === 'production' ? '5' : '5';
    url.searchParams.set('connection_limit', fromEnv || fallback);
  }

  if (!url.searchParams.has('pool_timeout')) {
    url.searchParams.set('pool_timeout', '20');
  }

  return withSupabaseSsl(url.toString());
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
