import { Router } from 'express';
import { z } from 'zod';
import type { HandoutRevealPayload } from '@grimoire/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { prisma } from '../lib/prisma';
import { getSocketServer } from '../socket';
import {
  assertCampaignGM,
  assertCampaignMember,
  createHandout,
  deleteHandout,
  getHandout,
  getReceipt,
  listCampaignHandouts,
  listUserHandoutJournal,
  revealHandoutToUsers,
  resolveRevealTargets,
  updateHandout,
} from '../services/handoutService';
import { getCobaltForUser, getOrSyncCharacter } from '../services/ddb/ddbService';
import { handoutItemMetaToPushInput, pushHandoutItemToDdb } from '../services/ddb/characterInventoryPush';

const router = Router();

const handoutTypeSchema = z.enum(['TEXT', 'IMAGE', 'MAP_FRAGMENT', 'ITEM_CARD']);

const itemMetaSchema = z.object({
  name: z.string().optional(),
  itemType: z.string().optional(),
  rarity: z.string().optional(),
  source: z.string().optional(),
  isCustom: z.boolean().optional(),
  compendiumItemId: z.string().optional(),
  ddbDefinitionId: z.number().int().positive().optional(),
}).optional().nullable();

const writeHandoutSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().max(50_000).optional().nullable(),
  imageUrl: z.string().max(2_000_000).optional().nullable(),
  type: handoutTypeSchema.optional(),
  compendiumItemId: z.string().optional().nullable(),
  ddbDefinitionId: z.number().int().positive().optional().nullable(),
  itemMeta: itemMetaSchema,
});

const revealSchema = z.object({
  sessionId: z.string().min(1),
  targetUserIds: z.union([z.literal('all'), z.array(z.string().min(1))]).default('all'),
});

const addInventorySchema = z.object({
  ddbCharacterId: z.number().int().positive(),
});

function emitRevealToUsers(payload: HandoutRevealPayload, userIds: string[]): void {
  const io = getSocketServer();
  if (!io) return;

  if (payload.targetUserIds === 'all') {
    io.to(payload.sessionId).emit('handout:reveal', payload);
    return;
  }

  const room = io.sockets.adapter.rooms.get(payload.sessionId);
  if (!room) return;
  for (const socketId of room) {
    const s = io.sockets.sockets.get(socketId);
    if (s && userIds.includes(s.data['userId'] as string)) {
      s.emit('handout:reveal', payload);
    }
  }
}

// GET /api/campaigns/:campaignId/handouts
router.get('/campaigns/:campaignId/handouts', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const member = await assertCampaignMember(campaignId, userId);
    if (!member) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    if (!member.isGM) {
      res.status(403).json({ error: 'Only the GM can manage handouts' });
      return;
    }
    const handouts = await listCampaignHandouts(campaignId);
    res.json({ handouts });
  } catch (err) {
    console.error('[Handouts] list error:', err);
    res.status(500).json({ error: 'Failed to list handouts' });
  }
});

// GET /api/campaigns/:campaignId/handout-journal
router.get('/campaigns/:campaignId/handout-journal', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const member = await assertCampaignMember(campaignId, userId);
    if (!member) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    const journal = await listUserHandoutJournal(userId, campaignId);
    res.json({ journal });
  } catch (err) {
    console.error('[Handouts] journal error:', err);
    res.status(500).json({ error: 'Failed to load journal' });
  }
});

// POST /api/campaigns/:campaignId/handouts
router.post('/campaigns/:campaignId/handouts', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    if (!(await assertCampaignGM(campaignId, userId))) {
      res.status(403).json({ error: 'Only the GM can create handouts' });
      return;
    }
    const parsed = writeHandoutSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid handout', details: parsed.error.flatten() });
      return;
    }
    const handout = await createHandout(campaignId, parsed.data);
    res.status(201).json({ handout });
  } catch (err) {
    console.error('[Handouts] create error:', err);
    res.status(500).json({ error: 'Failed to create handout' });
  }
});

// PATCH /api/handouts/:id
router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const existing = await getHandout(id);
    if (!existing) {
      res.status(404).json({ error: 'Handout not found' });
      return;
    }
    if (!(await assertCampaignGM(existing.campaignId, userId))) {
      res.status(403).json({ error: 'Only the GM can edit handouts' });
      return;
    }
    const parsed = writeHandoutSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid handout', details: parsed.error.flatten() });
      return;
    }
    const handout = await updateHandout(id, parsed.data);
    res.json({ handout });
  } catch (err) {
    console.error('[Handouts] update error:', err);
    res.status(500).json({ error: 'Failed to update handout' });
  }
});

// DELETE /api/handouts/:id
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const existing = await getHandout(id);
    if (!existing) {
      res.status(404).json({ error: 'Handout not found' });
      return;
    }
    if (!(await assertCampaignGM(existing.campaignId, userId))) {
      res.status(403).json({ error: 'Only the GM can delete handouts' });
      return;
    }
    await deleteHandout(id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[Handouts] delete error:', err);
    res.status(500).json({ error: 'Failed to delete handout' });
  }
});

// POST /api/handouts/:id/reveal
router.post('/:id/reveal', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const handout = await getHandout(id);
    if (!handout) {
      res.status(404).json({ error: 'Handout not found' });
      return;
    }
    if (!(await assertCampaignGM(handout.campaignId, userId))) {
      res.status(403).json({ error: 'Only the GM can reveal handouts' });
      return;
    }

    const parsed = revealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid reveal request', details: parsed.error.flatten() });
      return;
    }

    const session = await prisma.gameSession.findUnique({
      where: { id: parsed.data.sessionId },
      select: { id: true, campaignId: true, isActive: true },
    });
    if (!session || session.campaignId !== handout.campaignId) {
      res.status(400).json({ error: 'Invalid session for this campaign' });
      return;
    }

    const targetIds = await resolveRevealTargets(parsed.data.sessionId, parsed.data.targetUserIds);
    const receipts = await revealHandoutToUsers({
      handout,
      sessionId: parsed.data.sessionId,
      targetUserIds: targetIds,
    });

    for (const receipt of receipts) {
      const payload: HandoutRevealPayload = {
        sessionId: parsed.data.sessionId,
        handoutId: handout.id,
        receiptId: receipt.id,
        title: receipt.title,
        content: receipt.content ?? '',
        ...(receipt.imageUrl ? { imageUrl: receipt.imageUrl } : {}),
        type: receipt.type,
        ...(receipt.itemMeta ? { itemMeta: receipt.itemMeta } : {}),
        targetUserIds: [receipt.userId],
        animate: true,
      };
      emitRevealToUsers(payload, [receipt.userId]);
    }

    await prisma.sessionLog.create({
      data: {
        sessionId: parsed.data.sessionId,
        userId,
        type: 'HANDOUT_REVEAL',
        data: {
          handoutId: handout.id,
          title: handout.title,
          revealed: receipts.length,
        },
      },
    });

    res.json({ receipts, revealed: receipts.length });
  } catch (err) {
    console.error('[Handouts] reveal error:', err);
    res.status(500).json({ error: 'Failed to reveal handout' });
  }
});

// POST /api/handout-receipts/:id/add-to-inventory
router.post('/receipts/:id/add-to-inventory', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const receipt = await getReceipt(id);
    if (!receipt) {
      res.status(404).json({ error: 'Handout not found in journal' });
      return;
    }
    if (receipt.userId !== userId) {
      res.status(403).json({ error: 'You can only add items from your own journal' });
      return;
    }
    if (receipt.type !== 'ITEM_CARD') {
      res.status(400).json({ error: 'Only item card handouts can be added to inventory' });
      return;
    }

    const parsed = addInventorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const cobalt = await getCobaltForUser(userId);
    if (!cobalt) {
      res.status(400).json({ error: 'Link your D&D Beyond account first' });
      return;
    }

    const pushInput = handoutItemMetaToPushInput(receipt.itemMeta, receipt.title, receipt.content);
    if (receipt.ddbDefinitionId) pushInput.ddbDefinitionId = receipt.ddbDefinitionId;

    const result = await pushHandoutItemToDdb(cobalt, parsed.data.ddbCharacterId, pushInput);
    if (!result.ok) {
      res.status(502).json({ error: result.message ?? 'Failed to push item to D&D Beyond' });
      return;
    }

    await getOrSyncCharacter(userId, parsed.data.ddbCharacterId);

    res.json({
      ok: true,
      mode: result.mode,
      message: result.mode === 'official'
        ? 'Official D&D Beyond item added to your character.'
        : 'Custom item added to your D&D Beyond character.',
    });
  } catch (err) {
    console.error('[Handouts] add-to-inventory error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add item' });
  }
});

export default router;
