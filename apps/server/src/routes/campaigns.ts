import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { INVITE_CODE_LENGTH } from '@grimoire/shared';
import { getPrimaryClientUrl } from '../lib/clientOrigins';

const router = Router();

const activeSessionSelect = {
  where: { isActive: true as const },
  take: 1,
  select: { id: true, startedAt: true, isActive: true },
};

function pickActiveSession<T extends { sessions: { id: string; startedAt: Date; isActive: boolean }[] }>(
  campaign: T,
): Omit<T, 'sessions'> & { activeSession: { id: string; startedAt: Date; isActive: boolean } | null } {
  const { sessions, ...rest } = campaign;
  return { ...rest, activeSession: sessions[0] ?? null };
}

// ─── Validation schemas ───────────────────────────────────────────────────────

const createCampaignSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  coverImageUrl: z.string().url().optional(),
  system: z.string().default('D&D 5e'),
});

// ─── GET /api/campaigns ───────────────────────────────────────────────────────

router.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;

    const memberships = await prisma.campaignMember.findMany({
      where: { userId },
      include: {
        campaign: {
          include: {
            _count: { select: { members: true, scenes: true } },
            sessions: activeSessionSelect,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const campaigns = memberships.map((m: (typeof memberships)[number]) => ({
      ...pickActiveSession(m.campaign),
      myRole: m.role,
    }));

    res.json({ campaigns });
  } catch (err) {
    console.error('[Campaigns] list error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// ─── POST /api/campaigns ──────────────────────────────────────────────────────

router.post('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const parsed = createCampaignSchema.safeParse(req.body);

    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request body', details: parsed.error.flatten() });
      return;
    }

    const { name, description, coverImageUrl, system } = parsed.data;
    const inviteCode = nanoid(INVITE_CODE_LENGTH).toUpperCase();

    const campaign = await prisma.campaign.create({
      data: {
        name,
        description: description ?? null,
        coverImageUrl: coverImageUrl ?? null,
        system,
        inviteCode,
        gmId: userId,
        members: {
          create: { userId, role: 'GM' },
        },
      },
      include: {
        _count: { select: { members: true, scenes: true } },
      },
    });

    res.status(201).json({ campaign });
  } catch (err) {
    console.error('[Campaigns] create error:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// ─── GET /api/campaigns/:id ───────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      include: {
        members: {
          include: { user: { select: { id: true, username: true, avatarUrl: true } } },
        },
        scenes: { orderBy: { sortOrder: 'asc' } },
        sessions: activeSessionSelect,
        _count: { select: { members: true, scenes: true } },
      },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    const isMember = campaign.members.some((m: (typeof campaign.members)[number]) => m.userId === userId);
    if (!isMember) {
      res.status(403).json({ error: 'Access denied' });
      return;
    }

    const myRole = campaign.gmId === userId ? 'GM' : 'PLAYER';
    res.json({ campaign: pickActiveSession(campaign), myRole });
  } catch (err) {
    console.error('[Campaigns] get error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// ─── POST /api/campaigns/join ─────────────────────────────────────────────────

router.post('/join', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { inviteCode } = z.object({ inviteCode: z.string() }).parse(req.body);

    const campaign = await prisma.campaign.findUnique({
      where: { inviteCode: inviteCode.toUpperCase() },
      include: { sessions: activeSessionSelect },
    });

    if (!campaign) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    const activeSession = campaign.sessions[0] ?? null;

    const existing = await prisma.campaignMember.findUnique({
      where: { campaignId_userId: { campaignId: campaign.id, userId } },
    });

    if (existing) {
      res.status(409).json({
        error: 'Already a member',
        campaign: pickActiveSession(campaign),
        activeSession,
      });
      return;
    }

    await prisma.campaignMember.create({
      data: { campaignId: campaign.id, userId, role: 'PLAYER' },
    });

    res.status(201).json({ campaign: pickActiveSession(campaign), activeSession });
  } catch (err) {
    console.error('[Campaigns] join error:', err);
    res.status(500).json({ error: 'Failed to join campaign' });
  }
});

// ─── POST /api/campaigns/:id/sessions ────────────────────────────────────────

router.post('/:id/sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['id'] as string;

    const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign || campaign.gmId !== userId) {
      res.status(403).json({ error: 'Only the GM can start a session' });
      return;
    }

    // End any active sessions first
    await prisma.gameSession.updateMany({
      where: { campaignId, isActive: true },
      data: { isActive: false, endedAt: new Date() },
    });

    const session = await prisma.gameSession.create({
      data: { campaignId },
      select: { id: true, startedAt: true, isActive: true, campaignId: true },
    });

    res.status(201).json({ session });
  } catch (err) {
    console.error('[Campaigns] start session error:', err);
    res.status(500).json({ error: 'Failed to start session' });
  }
});

// ─── GET /api/campaigns/:id/invite ───────────────────────────────────────────

router.get('/:id/invite', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;

    const campaign = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, inviteCode: true, gmId: true },
    });

    if (!campaign || campaign.gmId !== userId) {
      res.status(403).json({ error: 'Only the GM can view the invite code' });
      return;
    }

    const inviteUrl = `${getPrimaryClientUrl()}/join/${campaign.inviteCode}`;
    res.json({ inviteCode: campaign.inviteCode, inviteUrl });
  } catch (err) {
    console.error('[Campaigns] invite error:', err);
    res.status(500).json({ error: 'Failed to get invite info' });
  }
});

export default router;
