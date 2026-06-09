/** Comma-separated browser origins allowed for CORS + Socket.io (e.g. app + www). */
export function getClientOrigins(): string[] {
  const raw = process.env['CLIENT_URLS'] ?? process.env['CLIENT_URL'];
  if (raw?.trim()) {
    const origins = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (origins.length > 0) return origins;
  }

  // Render sets RENDER_EXTERNAL_URL automatically (e.g. https://grimore.onrender.com)
  const renderUrl = process.env['RENDER_EXTERNAL_URL']?.trim().replace(/\/$/, '');
  if (renderUrl) return [renderUrl];

  return ['http://localhost:5173'];
}

export function getPrimaryClientUrl(): string {
  return getClientOrigins()[0]!;
}

export function isClientOriginAllowed(origin: string | undefined): boolean {
  // No Origin header — same-origin or non-browser clients.
  if (!origin) return true;
  const allowed = getClientOrigins();
  if (allowed.includes(origin)) return true;
  if (process.env['NODE_ENV'] !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return false;
}
