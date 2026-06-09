/** Comma-separated browser origins allowed for CORS + Socket.io (e.g. app + www). */
export function getClientOrigins(): string[] {
  const raw = process.env['CLIENT_URLS'] ?? process.env['CLIENT_URL'] ?? 'http://localhost:5173';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return origins.length > 0 ? origins : ['http://localhost:5173'];
}

export function getPrimaryClientUrl(): string {
  return getClientOrigins()[0]!;
}

export function isClientOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  const allowed = getClientOrigins();
  if (allowed.includes(origin)) return true;
  if (process.env['NODE_ENV'] !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return false;
}
