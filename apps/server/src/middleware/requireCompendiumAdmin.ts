import crypto from 'crypto';
import type { Response, NextFunction } from 'express';
import type { AuthenticatedRequest } from './auth';

export function getCompendiumAdminPassword(): string | null {
  const password = process.env['COMPENDIUM_ADMIN_PASSWORD']?.trim();
  return password || null;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** True when a raw password string matches the configured admin password. */
export function matchesCompendiumAdminPassword(password: string): boolean {
  const expected = getCompendiumAdminPassword();
  if (!expected) return false;
  return safeEqual(password, expected);
}

/** True when request includes the configured compendium admin password. */
export function isCompendiumAdmin(req: AuthenticatedRequest): boolean {
  const provided = req.header('x-compendium-admin-password') ?? '';
  return matchesCompendiumAdminPassword(provided);
}

export function requireCompendiumAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): void {
  if (!getCompendiumAdminPassword()) {
    res.status(503).json({ error: 'Compendium admin password is not configured on the server' });
    return;
  }
  if (!isCompendiumAdmin(req)) {
    res.status(403).json({ error: 'Compendium admin password required' });
    return;
  }
  next();
}
