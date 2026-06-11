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
