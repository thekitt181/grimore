import { Router } from 'express';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { readPrisma, runSerializedWrite } from '../lib/prisma';
import { isDbPoolSaturation, isDbTransientError, withDbTimeout } from '../lib/dbTimeout';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { INVITE_CODE_LENGTH } from '@grimoire/shared';
import { getPrimaryClientUrl } from '../lib/clientOrigins';
import { stopRollBridge } from '../services/ddb/ddbRollBridge';

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

const CAMPAIGN_DB_TIMEOUT_MS = 15_000;
const CAMPAIGN_TX_TIMEOUT_MS = 30_000;

function respondCampaignDbError(
  res: import('express').Response,
  err: unknown,
  logLabel: string,
  message: string,
): void {
  if (isDbPoolSaturation(err) || isDbTransientError(err)) {
    res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
    return;
  }
  console.error(logLabel, err);
  res.status(500).json({ error: message });
}

// ─── GET /api/campaigns ───────────────────────────────────────────────────────

router.get('/', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;

    const memberships = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaignMember.findMany({
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
        }),
      'campaigns.list',
    );

    const campaigns = memberships.map((m: (typeof memberships)[number]) => ({
      ...pickActiveSession(m.campaign),
      myRole: m.role,
    }));

    res.json({ campaigns });
  } catch (err) {
    respondCampaignDbError(res, err, '[Campaigns] list error:', 'Failed to fetch campaigns');
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

    const campaign = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaign.create({
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
        }),
      'campaigns.create',
    );

    res.status(201).json({ campaign });
  } catch (err) {
    respondCampaignDbError(res, err, '[Campaigns] create error:', 'Failed to create campaign');
  }
});

// ─── GET /api/campaigns/:id ───────────────────────────────────────────────────

router.get('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;

    const campaign = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaign.findUnique({
          where: { id },
          include: {
            members: {
              include: { user: { select: { id: true, username: true, avatarUrl: true } } },
            },
            sessions: activeSessionSelect,
            _count: { select: { members: true, scenes: true } },
          },
        }),
      'campaigns.get',
    );

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
    respondCampaignDbError(res, err, '[Campaigns] get error:', 'Failed to fetch campaign');
  }
});

// ─── POST /api/campaigns/join ─────────────────────────────────────────────────

router.post('/join', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const { inviteCode } = z.object({ inviteCode: z.string() }).parse(req.body);

    const campaign = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaign.findUnique({
          where: { inviteCode: inviteCode.toUpperCase() },
          include: { sessions: activeSessionSelect },
        }),
      'campaigns.join.lookup',
    );

    if (!campaign) {
      res.status(404).json({ error: 'Invalid invite code' });
      return;
    }

    const activeSession = campaign.sessions[0] ?? null;

    const existing = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaignMember.findUnique({
          where: { campaignId_userId: { campaignId: campaign.id, userId } },
        }),
      'campaigns.join.member',
    );

    if (existing) {
      res.status(409).json({
        error: 'Already a member',
        campaign: pickActiveSession(campaign),
        activeSession,
      });
      return;
    }

    await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaignMember.create({
          data: { campaignId: campaign.id, userId, role: 'PLAYER' },
        }),
      'campaigns.join.create',
    );

    res.status(201).json({ campaign: pickActiveSession(campaign), activeSession });
  } catch (err) {
    respondCampaignDbError(res, err, '[Campaigns] join error:', 'Failed to join campaign');
  }
});

// ─── POST /api/campaigns/:id/sessions ────────────────────────────────────────

router.post('/:id/sessions', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['id'] as string;

    const campaign = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () => readPrisma.campaign.findUnique({ where: { id: campaignId } }),
      'campaigns.sessions.lookup',
    );
    if (!campaign || campaign.gmId !== userId) {
      res.status(403).json({ error: 'Only the GM can start a session' });
      return;
    }

    await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.gameSession.updateMany({
          where: { campaignId, isActive: true },
          data: { isActive: false, endedAt: new Date() },
        }),
      'campaigns.sessions.end-active',
    );

    const session = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.gameSession.create({
          data: { campaignId },
          select: { id: true, startedAt: true, isActive: true, campaignId: true },
        }),
      'campaigns.sessions.create',
    );

    res.status(201).json({ session });
  } catch (err) {
    respondCampaignDbError(res, err, '[Campaigns] start session error:', 'Failed to start session');
  }
});

// ─── DELETE /api/campaigns/:id ──────────────────────────────────────────────

router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;

    const campaign = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaign.findUnique({
          where: { id },
          select: {
            id: true,
            gmId: true,
            sessions: { select: { id: true } },
          },
        }),
      'campaigns.delete.lookup',
    );

    if (!campaign) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }

    if (campaign.gmId !== userId) {
      res.status(403).json({ error: 'Only the GM can delete this campaign' });
      return;
    }

    const sessionIds = campaign.sessions.map((s) => s.id);

    for (const sessionId of sessionIds) {
      stopRollBridge(sessionId);
    }

    await withDbTimeout(
      CAMPAIGN_TX_TIMEOUT_MS,
      () =>
        runSerializedWrite(() =>
          readPrisma.$transaction(async (tx) => {
            if (sessionIds.length > 0) {
              await tx.chatMessage.deleteMany({ where: { sessionId: { in: sessionIds } } });
              await tx.sessionLog.deleteMany({ where: { sessionId: { in: sessionIds } } });
            }
            await tx.gameSession.deleteMany({ where: { campaignId: id } });
            await tx.scene.deleteMany({ where: { campaignId: id } });
            await tx.gameMap.deleteMany({ where: { campaignId: id } });
            await tx.encounter.deleteMany({ where: { campaignId: id } });
            await tx.handout.deleteMany({ where: { campaignId: id } });
            await tx.note.deleteMany({ where: { campaignId: id } });
            await tx.campaign.delete({ where: { id } });
          }),
        ),
      'campaigns.delete.tx',
    );

    res.json({ ok: true });
  } catch (err) {
    respondCampaignDbError(res, err, '[Campaigns] delete error:', 'Failed to delete campaign');
  }
});

// ─── GET /api/campaigns/:id/invite ───────────────────────────────────────────

router.get('/:id/invite', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;

    const campaign = await withDbTimeout(
      CAMPAIGN_DB_TIMEOUT_MS,
      () =>
        readPrisma.campaign.findUnique({
          where: { id },
          select: { id: true, inviteCode: true, gmId: true },
        }),
      'campaigns.invite',
    );

    if (!campaign || campaign.gmId !== userId) {
      res.status(403).json({ error: 'Only the GM can view the invite code' });
      return;
    }

    const inviteUrl = `${getPrimaryClientUrl()}/join/${campaign.inviteCode}`;
    res.json({ inviteCode: campaign.inviteCode, inviteUrl });
  } catch (err) {
    respondCampaignDbError(res, err, '[Campaigns] invite error:', 'Failed to get invite info');
  }
});

export default router;
