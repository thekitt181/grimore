const STORAGE_KEY = 'grimoire.auth.next';

/** Same-origin path only — blocks open redirects. */
export function sanitizeReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const path = raw.trim();
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) return null;
  if (path.startsWith('/sign-in') || path.startsWith('/sign-up')) return null;
  return path;
}

export function rememberReturnPath(path: string | null | undefined): void {
  const safe = sanitizeReturnPath(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, safe);
  } catch {
    /* ignore quota / private mode */
  }
}

export function consumeReturnPath(search?: string): string {
  const fromQuery = sanitizeReturnPath(new URLSearchParams(search ?? '').get('next'));
  let fromStore: string | null = null;
  try {
    fromStore = sanitizeReturnPath(sessionStorage.getItem(STORAGE_KEY));
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    fromStore = null;
  }
  return fromQuery ?? fromStore ?? '/';
}

export function signInHref(returnPath?: string): string {
  const safe = sanitizeReturnPath(returnPath);
  if (!safe) return '/sign-in';
  return `/sign-in?next=${encodeURIComponent(safe)}`;
}

export function signUpHref(returnPath?: string, search?: string): string {
  const safe = sanitizeReturnPath(returnPath) ?? sanitizeReturnPath(new URLSearchParams(search ?? '').get('next'));
  if (!safe) return '/sign-up';
  return `/sign-up?next=${encodeURIComponent(safe)}`;
}
