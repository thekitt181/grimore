import { Router } from 'express';
import { prisma } from '../lib/prisma';
import { requireAuth } from '../middleware/auth';
const router = Router();
// GET /api/sessions/:id — get session info (needed by client to know campaignId)
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.userId;
        const id = req.params['id'];
        const session = await prisma.gameSession.findUnique({
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
        });
        if (!session) {
            res.status(404).json({ error: 'Session not found' });
            return;
        }
        const isMember = session.campaign.members.some((m) => m.userId === userId);
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
                myRole,
                myUserId: userId,
            },
        });
    }
    catch (err) {
        console.error('[Sessions] get error:', err);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
});
export default router;
//# sourceMappingURL=sessions.js.map