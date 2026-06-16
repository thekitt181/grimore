import type { Response, NextFunction } from 'express';
import { readPrisma } from '../lib/prisma';
import { isDbPoolSaturation } from '../lib/dbTimeout';
import type { AuthenticatedRequest } from './auth';

/** Requires X-Session-Id header and that the user is the campaign GM. */
export async function requireSessionGM(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const sessionId = req.header('x-session-id');
  const userId = req.userId;

  if (!sessionId || !userId) {
    res.status(403).json({ error: 'GM access required' });
    return;
  }

  try {
    const session = await readPrisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { campaign: { select: { gmId: true } } },
    });

    if (!session || session.campaign.gmId !== userId) {
      res.status(403).json({ error: 'GM access required' });
      return;
    }

    next();
  } catch (err) {
    if (isDbPoolSaturation(err)) {
      res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      return;
    }
    throw err;
  }
}
