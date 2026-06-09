import type { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
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

  const session = await prisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { campaignId: true },
  });
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const member = await prisma.campaignMember.findFirst({
    where: { campaignId: session.campaignId, userId },
  });
  if (!member) {
    res.status(403).json({ error: 'Session access required' });
    return;
  }

  next();
}
