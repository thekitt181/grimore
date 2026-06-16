import { Router } from 'express';
import { authPrisma } from '../lib/prisma';
import { withDbTimeout, isDbPoolSaturation } from '../lib/dbTimeout';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';

const router = Router();

// GET /api/users/me — return the current user's profile
router.get('/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    if (req.authUser) {
      res.json({
        user: {
          id: req.authUser.id,
          username: req.authUser.username,
          avatarUrl: req.authUser.avatarUrl,
        },
      });
      return;
    }

    const user = await withDbTimeout(
      8_000,
      () =>
        authPrisma.user.findUnique({
          where: { id: req.userId! },
          select: { id: true, username: true, avatarUrl: true, createdAt: true },
        }),
      'users.me',
    );

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({ user });
  } catch (err) {
    if (isDbPoolSaturation(err)) {
      res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
      return;
    }
    console.error('[Users] me error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

export default router;
