/** Runtime Postgres URL with safe pool settings (Supabase-friendly). */
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

  return url.toString();
}
