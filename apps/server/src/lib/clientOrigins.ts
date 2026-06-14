/** Comma-separated browser origins allowed for CORS + Socket.io (e.g. app + www). */
export function getClientOrigins(): string[] {
  const origins = new Set<string>();

  const addOrigins = (raw: string | undefined): void => {
    if (!raw?.trim()) return;
    for (const part of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (part.startsWith('//')) {
        origins.add(`https:${part}`);
        origins.add(`http:${part}`);
        continue;
      }
      origins.add(part.replace(/\/$/, ''));
    }
  };

  // Always merge both — CLIENT_URLS alone must not hide CLIENT_URL.
  addOrigins(process.env['CLIENT_URLS']);
  addOrigins(process.env['CLIENT_URL']);

  const renderUrl = process.env['RENDER_EXTERNAL_URL']?.trim().replace(/\/$/, '');
  if (renderUrl) origins.add(renderUrl);

  if (origins.size > 0) return [...origins];

  return ['http://localhost:5173'];
}

export function getPrimaryClientUrl(): string {
  const configured = process.env['CLIENT_URL']?.trim().replace(/\/$/, '');
  if (configured) return configured;
  const renderUrl = process.env['RENDER_EXTERNAL_URL']?.trim().replace(/\/$/, '');
  if (renderUrl) return renderUrl;
  return getClientOrigins()[0]!;
}

export function isClientOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = getClientOrigins();
  if (allowed.includes(origin)) return true;
  if (process.env['NODE_ENV'] !== 'production') {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return false;
}
