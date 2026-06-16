import type { Request, Response, NextFunction } from 'express';
import { resolveAuthUser, type AuthUserRecord } from '../lib/authUserCache';
import { isDbPoolSaturation, isDbTransientError } from '../lib/dbTimeout';
import { getAuthUserIdFromHeaders } from '../lib/sessionAuth';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  authUserId?: string;
  authUser?: AuthUserRecord;
}

/**
 * Verifies Better Auth session (cookie or Bearer token) and attaches app userId.
 */
export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const authUserId = await getAuthUserIdFromHeaders(req.headers);
    if (!authUserId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const user = await resolveAuthUser(authUserId);

    req.userId = user.id;
    req.authUserId = authUserId;
    req.authUser = user;
    next();
  } catch (err) {
    if (isDbPoolSaturation(err) || isDbTransientError(err)) {
      console.error('[Auth] DB busy during session verification:', err);
      res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      return;
    }
    console.error('[Auth] Session verification failed:', err);
    res.status(401).json({ error: 'Unauthorized' });
  }
}
