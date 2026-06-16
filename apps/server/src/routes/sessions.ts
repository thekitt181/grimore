import { Router } from 'express';
import { readPrisma } from '../lib/prisma';
import { isDbPoolSaturation, withDbTimeout } from '../lib/dbTimeout';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';

const router = Router();

const SESSION_READ_TIMEOUT_MS = 10_000;

// GET /api/sessions/:id — get session info (needed by client to know campaignId)
router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;

    const session = await withDbTimeout(
      SESSION_READ_TIMEOUT_MS,
      () =>
        readPrisma.gameSession.findUnique({
          where: { id },
          include: {
            campaign: {
              select: {
                id: true,
                name: true,
                gmId: true,
                members: { select: { userId: true, role: true } },
              },
            },
          },
        }),
      'sessions.get',
    );

    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const isMember = session.campaign.members.some(
      (m: (typeof session.campaign.members)[number]) => m.userId === userId,
    );
    if (!isMember) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const myRole = session.campaign.gmId === userId ? 'GM' : 'PLAYER';

    res.json({
      session: {
        id: session.id,
        campaignId: session.campaignId,
        campaignName: session.campaign.name,
        isActive: session.isActive,
        startedAt: session.startedAt,
        activeSceneId: session.activeSceneId,
        myRole,
        myUserId: userId,
      },
    });
  } catch (err) {
    if (isDbPoolSaturation(err)) {
      res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      return;
    }
    console.error('[Sessions] get error:', err);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

export default router;
