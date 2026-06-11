let blockedUntil = 0;
let blockReason: string | null = null;
let lastVerifiedAt = 0;

const BLOCK_MS = 45_000;
const VERIFY_TTL_MS = 20_000;

export function markApiAuthBlocked(reason: string): void {
  blockedUntil = Date.now() + BLOCK_MS;
  blockReason = reason;
}

export function clearApiAuthBlocked(): void {
  blockedUntil = 0;
  blockReason = null;
  lastVerifiedAt = Date.now();
}

export function isApiAuthBlocked(): boolean {
  return Date.now() < blockedUntil;
}

export function getApiAuthBlockReason(): string | null {
  return isApiAuthBlocked() ? blockReason : null;
}

export function wasApiSessionVerifiedRecently(): boolean {
  return Date.now() - lastVerifiedAt < VERIFY_TTL_MS;
}

export function isClerkDevKeyOnPublicSite(): boolean {
  const key = import.meta.env['VITE_CLERK_PUBLISHABLE_KEY'] as string | undefined;
  if (!key?.startsWith('pk_test_')) return false;
  if (typeof window === 'undefined') return false;
  return !/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname);
}
