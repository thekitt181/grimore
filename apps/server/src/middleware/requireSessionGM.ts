import type { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
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

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    include: { campaign: { select: { gmId: true } } },
  });

  if (!session || session.campaign.gmId !== userId) {
    res.status(403).json({ error: 'GM access required' });
    return;
  }

  next();
}
