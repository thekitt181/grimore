import type { Request, Response, NextFunction } from 'express';
import { resolveAuthUser } from '../lib/authUserCache';
import { getAuthUserIdFromHeaders } from '../lib/sessionAuth';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  authUserId?: string;
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
    next();
  } catch (err) {
    console.error('[Auth] Session verification failed:', err);
    res.status(401).json({ error: 'Unauthorized' });
  }
}
