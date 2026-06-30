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

  if (origins.size > 0) return expandOriginWwwVariants([...origins]);

  return ['http://localhost:5173'];
}

/** Allow both apex and www when either is configured (common mobile/bookmark mismatch). */
function expandOriginWwwVariants(origins: string[]): string[] {
  const expanded = new Set(origins);
  for (const origin of origins) {
    try {
      const url = new URL(origin);
      const host = url.hostname.toLowerCase();
      if (host === 'localhost' || host.startsWith('127.') || host.endsWith('.onrender.com')) continue;
      if (host.startsWith('www.')) {
        expanded.add(`${url.protocol}//${host.slice(4)}`);
      } else {
        expanded.add(`${url.protocol}//www.${host}`);
      }
    } catch {
      /* ignore invalid URLs */
    }
  }
  return [...expanded];
}

export function getPrimaryClientUrl(): string {
  const configured = process.env['CLIENT_URL']?.trim().replace(/\/$/, '');
  if (configured) return configured;
  const renderUrl = process.env['RENDER_EXTERNAL_URL']?.trim().replace(/\/$/, '');
  if (renderUrl) return renderUrl;
  return getClientOrigins()[0]!;
}

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

const MULTI_PART_PUBLIC_SUFFIXES = ['.co.uk', '.org.uk', '.com.au', '.co.nz', '.co.jp'] as const;

/** Registrable domain for sharing auth cookies between www and apex (e.g. grimore.co.uk). */
export function getSharedAuthCookieDomain(): string | undefined {
  const primary = hostnameFromUrl(getPrimaryClientUrl());
  if (!primary || primary === 'localhost' || primary.startsWith('127.') || primary.endsWith('.onrender.com')) {
    return undefined;
  }
  const normalized = primary.startsWith('www.') ? primary.slice(4) : primary;

  for (const suffix of MULTI_PART_PUBLIC_SUFFIXES) {
    if (!normalized.endsWith(suffix)) continue;
    const label = normalized.slice(0, -suffix.length);
    const leaf = label.split('.').pop();
    return leaf ? `${leaf}${suffix}` : normalized;
  }

  const parts = normalized.split('.');
  if (parts.length < 2) return undefined;
  return parts.slice(-2).join('.');
}

/** Canonical host from CLIENT_URL / BETTER_AUTH_URL (no www prefix). */
export function getCanonicalClientHostname(): string | null {
  const host = hostnameFromUrl(getPrimaryClientUrl());
  if (!host) return null;
  return host.startsWith('www.') ? host.slice(4) : host;
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
