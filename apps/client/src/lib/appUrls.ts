/**
 * Production URL layout:
 * - Same domain: leave VITE_SERVER_URL empty → /api + sockets on window.location.origin
 * - Split domains: VITE_SERVER_URL=https://api.yourdomain.com
 */
function configuredServerOrigin(): string | undefined {
  const raw = import.meta.env['VITE_SERVER_URL'] as string | undefined;
  if (!raw?.trim()) return undefined;
  return raw.trim().replace(/\/$/, '');
}

/** Origin for Socket.io — same origin in dev (Vite proxies /socket.io → :3001). */
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
  if (override?.trim()) return override.trim().replace(/\/$/, '');
  return window.location.origin;
}
