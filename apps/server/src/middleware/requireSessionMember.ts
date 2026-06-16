import type { Response, NextFunction } from 'express';
import { readPrisma } from '../lib/prisma';
import { isDbPoolSaturation } from '../lib/dbTimeout';
import type { AuthenticatedRequest } from './auth';

/** Requires X-Session-Id and that the user belongs to the session's campaign. */
export async function requireSessionMember(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionId = req.header('x-session-id');
  const userId = req.userId;

  if (!sessionId || !userId) {
    res.status(403).json({ error: 'Session access required' });
    return;
  }

  try {
    const session = await readPrisma.gameSession.findUnique({
      where: { id: sessionId },
      select: { campaignId: true },
    });
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const member = await readPrisma.campaignMember.findFirst({
      where: { campaignId: session.campaignId, userId },
    });
    if (!member) {
      res.status(403).json({ error: 'Session access required' });
      return;
    }

    next();
  } catch (err) {
    if (isDbPoolSaturation(err)) {
      res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      return;
    }
    console.error('[Auth] Session member check failed:', err);
    res.status(500).json({ error: 'Session verification failed' });
  }
}
