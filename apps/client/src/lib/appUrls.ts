/**
 * Production URL layout:
 * - Same domain: leave VITE_SERVER_URL empty → /api + sockets on window.location.origin
 * - Split domains: VITE_SERVER_URL=https://api.yourdomain.com
 */

function isLocalhostUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

/** Resolve VITE_SERVER_URL, ignoring localhost when the page is on a real host. */
function configuredServerOrigin(): string | undefined {
  const raw = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  if (!raw?.trim()) return undefined;

  const url = raw.trim().replace(/\/$/, '');

  if (typeof window !== 'undefined' && import.meta.env.DEV && isLocalhostUrl(url)) {
    const port = window.location.port;
    if (port === '5173' || port === '') {
      console.warn(
        '[Grimoire] Ignoring localhost VITE_SERVER_URL in dev — API requests use the Vite /api proxy.',
      );
      return undefined;
    }
  }

  if (typeof window !== 'undefined' && isLocalhostUrl(url) && !isLocalhostUrl(window.location.origin)) {
    console.warn(
      '[Grimoire] VITE_SERVER_URL points at localhost but the app is on',
      window.location.origin,
      '— using same-origin instead.',
    );
    return undefined;
  }

  return url;
}

/** Origin for Socket.io. Dev: Vite proxies /socket.io. Prod: same host as the page unless split API domain. */
export function getServerOrigin(): string {
  const configured = configuredServerOrigin();
  if (configured) return configured;
  if (typeof window !== 'undefined') return window.location.origin;
  if (import.meta.env.DEV) return 'http://localhost:5173';
  return '';
}

/** REST API base path. Dev uses Vite proxy (/api → localhost:3001). */
export function getApiBaseUrl(): string {
  const configured = configuredServerOrigin();
  if (configured) return `${configured}/api`;
  return '/api';
}

/** Public app URL for invite links (optional override). */
export function getPublicAppUrl(): string {
  const override = import.meta.env['VITE_APP_URL'] as string | undefined;
  if (override?.trim()) {
    const url = override.trim().replace(/\/$/, '');
    if (typeof window !== 'undefined' && isLocalhostUrl(url) && !isLocalhostUrl(window.location.origin)) {
      return window.location.origin;
    }
    return url;
  }
  if (typeof window === 'undefined') return '';

  const origin = window.location.origin;
  try {
    const url = new URL(origin);
    if (url.hostname.startsWith('www.')) {
      url.hostname = url.hostname.slice(4);
      return url.origin;
    }
  } catch {
    /* ignore */
  }
  return origin;
}
