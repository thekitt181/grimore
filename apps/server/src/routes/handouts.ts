import { Router } from 'express';
import { z } from 'zod';
import type { HandoutRevealPayload } from '@grimoire/shared';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { readPrisma } from '../lib/prisma';
import { isDbPoolSaturation, withDbTimeout } from '../lib/dbTimeout';
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
  upsertSceneItemHandout,
} from '../services/handoutService';
import { getCobaltForUser, getOrSyncCharacter } from '../services/ddb/ddbService';
import { DDB_URLS } from '../services/ddb/config';
import { handoutItemMetaToPushInput, pushHandoutItemToDdb } from '../services/ddb/characterInventoryPush';
import { synthesizeCompendiumItemDescription } from '@grimoire/shared';
import { getItemById } from '../services/compendiumSync';

const router = Router();

const HANDOUT_DB_TIMEOUT_MS = 10_000;

function respondHandoutDbError(
  res: import('express').Response,
  err: unknown,
  logLabel: string,
  message: string,
): void {
  if (isDbPoolSaturation(err)) {
    res.status(503).json({ error: 'Database busy — try again shortly', retry: true });
    return;
  }
  console.error(logLabel, err);
  res.status(500).json({ error: message });
}

const handoutTypeSchema = z.enum(['TEXT', 'IMAGE', 'MAP_FRAGMENT', 'ITEM_CARD']);

const itemMetaSchema = z.object({
  name: z.string().optional(),
  itemType: z.string().optional(),
  rarity: z.string().optional(),
  source: z.string().optional(),
  isCustom: z.boolean().optional(),
  compendiumItemId: z.string().optional(),
  ddbDefinitionId: z.number().int().positive().optional(),
  sceneItemId: z.string().optional(),
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

const sceneRevealSchema = z.object({
  sessionId: z.string().min(1),
  sceneItemId: z.string().min(1),
  title: z.string().min(1).max(200),
  content: z.string().max(50_000).optional().nullable(),
  imageUrl: z.string().max(2_000_000).optional().nullable(),
  compendiumItemId: z.string().optional().nullable(),
  itemMeta: itemMetaSchema,
  targetUserIds: z.union([z.literal('all'), z.array(z.string().min(1))]).default('all'),
  pushToDdb: z.object({
    ddbCharacterId: z.number().int().positive(),
    target: z.enum(['character', 'party']).default('character'),
    targetUserId: z.string().min(1),
  }).optional(),
});

const addInventorySchema = z.object({
  ddbCharacterId: z.number().int().positive(),
  target: z.enum(['character', 'party']).default('character'),
  /** Visible handout body from the journal viewer (overrides stale/empty receipt content). */
  description: z.string().max(50_000).optional(),
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

function getConnectedPlayerIds(sessionId: string, gmId: string): string[] {
  const io = getSocketServer();
  if (!io) return [];
  const room = io.sockets.adapter.rooms.get(sessionId);
  if (!room) return [];
  const ids: string[] = [];
  for (const socketId of room) {
    const s = io.sockets.sockets.get(socketId);
    const uid = s?.data['userId'] as string | undefined;
    const role = s?.data['role'] as string | undefined;
    if (uid && role === 'PLAYER' && uid !== gmId) ids.push(uid);
  }
  return [...new Set(ids)];
}

async function resolveRevealTargetsForSession(
  sessionId: string,
  targetUserIds: string[] | 'all',
): Promise<string[]> {
  const session = await readPrisma.gameSession.findUnique({
    where: { id: sessionId },
    select: { campaign: { select: { gmId: true } } },
  });
  const connectedPlayerIds = session
    ? getConnectedPlayerIds(sessionId, session.campaign.gmId)
    : [];
  return resolveRevealTargets(sessionId, targetUserIds, { connectedPlayerIds });
}

async function resolveDdbCampaignId(campaignId: string): Promise<number | null> {
  const link = await readPrisma.ddbCampaignLink.findUnique({ where: { campaignId } });
  return link?.ddbCampaignId ?? null;
}

function inventoryManualFallback(
  ddbCharacterId: number,
  receipt: NonNullable<Awaited<ReturnType<typeof getReceipt>>>,
  target: 'character' | 'party' = 'character',
): {
  characterUrl: string;
  itemName: string;
  isCustom: boolean;
  target: 'character' | 'party';
} {
  const meta = receipt.itemMeta;
  const source = (meta?.source ?? '').trim().toLowerCase();
  const hasDdbDefinition = Boolean(
    (receipt.ddbDefinitionId && receipt.ddbDefinitionId > 0)
    || (meta?.ddbDefinitionId && meta.ddbDefinitionId > 0),
  );
  const isCustom = Boolean(
    meta?.isCustom === true
    || (!hasDdbDefinition && meta?.isCustom !== false)
    || source === 'custom'
    || source === 'd&d beyond homebrew'
    || source.includes('grimoire'),
  );
  return {
    characterUrl: `${DDB_URLS.characterPage}/${ddbCharacterId}`,
    itemName: meta?.name?.trim() || receipt.title,
    isCustom,
    target,
  };
}

async function resolveHandoutPushContent(
  receipt: NonNullable<Awaited<ReturnType<typeof getReceipt>>>,
  override?: string | null,
): Promise<string | null | undefined> {
  const fromOverride = override?.trim();
  if (fromOverride) return fromOverride;

  const fromReceipt = receipt.content?.trim();
  if (fromReceipt) return fromReceipt;

  const handout = await getHandout(receipt.handoutId);
  const fromHandout = handout?.content?.trim();
  if (fromHandout) return fromHandout;

  const compendiumId = receipt.compendiumItemId ?? receipt.itemMeta?.compendiumItemId;
  if (compendiumId) {
    try {
      const compItem = await getItemById(compendiumId);
      if (compItem) {
        const synthesized = synthesizeCompendiumItemDescription(compItem);
        if (synthesized) return synthesized;
      }
    } catch (err) {
      console.warn('[Handouts] compendium description lookup skipped:', err);
    }
  }

  const fromReceiptMeta = synthesizeCompendiumItemDescription({
    name: receipt.title,
    type: receipt.itemMeta?.itemType,
    description: receipt.content ?? undefined,
  });
  if (fromReceiptMeta) return fromReceiptMeta;

  return receipt.content;
}

async function pushReceiptToDdbForUser(opts: {
  receiptUserId: string;
  receipt: NonNullable<Awaited<ReturnType<typeof getReceipt>>>;
  ddbCharacterId: number;
  target: 'character' | 'party';
  campaignId: string;
  gmUserId?: string;
  descriptionOverride?: string | null;
}): Promise<{ ok: boolean; mode: string; message: string }> {
  const pushContent = await resolveHandoutPushContent(opts.receipt, opts.descriptionOverride);
  const pushInput = handoutItemMetaToPushInput(opts.receipt.itemMeta, opts.receipt.title, pushContent);
  if (opts.receipt.ddbDefinitionId) pushInput.ddbDefinitionId = opts.receipt.ddbDefinitionId;

  const linkedDdbCampaignId = await resolveDdbCampaignId(opts.campaignId);

  if (opts.target === 'party' && !linkedDdbCampaignId) {
    return {
      ok: false,
      mode: 'failed',
      message: 'Link this Grimoire campaign to a D&D Beyond campaign for party inventory.',
    };
  }

  const cobaltUserIds = [...new Set([opts.receiptUserId, opts.gmUserId].filter(Boolean) as string[])];

  let lastMessage = 'Link a D&D Beyond account in Grimoire Settings (CobaltSession cookie from dndbeyond.com).';
  let triedCobalt = false;
  for (const cobaltUserId of cobaltUserIds) {
    const cobalt = await getCobaltForUser(cobaltUserId);
    if (!cobalt) continue;
    triedCobalt = true;

    const result = await pushHandoutItemToDdb(cobalt, opts.ddbCharacterId, pushInput, {
      target: opts.target,
      ...(linkedDdbCampaignId ? { ddbCampaignId: linkedDdbCampaignId } : {}),
    });

    if (result.ok) {
      try {
        await getOrSyncCharacter(cobaltUserId, opts.ddbCharacterId);
      } catch (syncErr) {
        console.warn('[Handouts] character cache sync after inventory push failed:', syncErr);
      }
      const targetLabel = opts.target === 'party' ? 'party inventory' : 'character sheet';
      return {
        ok: true,
        mode: result.mode,
        message: result.message ?? (
          result.mode === 'official'
            ? `Official item added to ${targetLabel}.`
            : `Custom item added to ${targetLabel}.`
        ),
      };
    }
    lastMessage = result.message ?? lastMessage;
  }

  if (!triedCobalt) {
    return { ok: false, mode: 'failed', message: lastMessage };
  }

  return { ok: false, mode: 'failed', message: lastMessage };
}

// GET /api/campaigns/:campaignId/handouts
router.get('/campaigns/:campaignId/handouts', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const member = await withDbTimeout(
      HANDOUT_DB_TIMEOUT_MS,
      () => assertCampaignMember(campaignId, userId),
      'handouts.list.access',
    );
    if (!member) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    if (!member.isGM) {
      res.status(403).json({ error: 'Only the GM can manage handouts' });
      return;
    }
    const handouts = await withDbTimeout(
      HANDOUT_DB_TIMEOUT_MS,
      () => listCampaignHandouts(campaignId),
      'handouts.list',
    );
    res.json({ handouts });
  } catch (err) {
    respondHandoutDbError(res, err, '[Handouts] list error:', 'Failed to list handouts');
  }
});

// GET /api/campaigns/:campaignId/handout-journal
router.get('/campaigns/:campaignId/handout-journal', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const member = await withDbTimeout(
      HANDOUT_DB_TIMEOUT_MS,
      () => assertCampaignMember(campaignId, userId),
      'handouts.journal.access',
    );
    if (!member) {
      res.status(404).json({ error: 'Campaign not found' });
      return;
    }
    const journal = await withDbTimeout(
      HANDOUT_DB_TIMEOUT_MS,
      () => listUserHandoutJournal(userId, campaignId),
      'handouts.journal',
    );
    res.json({ journal });
  } catch (err) {
    respondHandoutDbError(res, err, '[Handouts] journal error:', 'Failed to load journal');
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

// POST /api/handouts/scene-reveal — persist map item handout + journal receipts
router.post('/scene-reveal', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const parsed = sceneRevealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid scene reveal request', details: parsed.error.flatten() });
      return;
    }

    const session = await readPrisma.gameSession.findUnique({
      where: { id: parsed.data.sessionId },
      select: { id: true, campaignId: true, isActive: true },
    });
    if (!session) {
      res.status(400).json({ error: 'Invalid session' });
      return;
    }
    if (!(await assertCampaignGM(session.campaignId, userId))) {
      res.status(403).json({ error: 'Only the GM can reveal handouts' });
      return;
    }

    let itemMeta = parsed.data.itemMeta ?? {};
    let ddbDefinitionId = itemMeta.ddbDefinitionId ?? null;
    let isCustom = itemMeta.isCustom;
    let compItem: Awaited<ReturnType<typeof getItemById>> = null;

    if (parsed.data.compendiumItemId) {
      try {
        compItem = await getItemById(parsed.data.compendiumItemId);
        if (compItem) {
          if (isCustom === undefined) isCustom = compItem.isCustom;
          itemMeta = {
            ...itemMeta,
            name: itemMeta.name ?? compItem.name,
            itemType: itemMeta.itemType ?? compItem.type,
            rarity: itemMeta.rarity ?? compItem.rarity,
            source: itemMeta.source ?? compItem.source,
            isCustom,
            compendiumItemId: parsed.data.compendiumItemId,
          };
        }
      } catch (compErr) {
        console.warn('[Handouts] compendium item lookup skipped:', compErr);
      }
    }

    itemMeta = {
      ...itemMeta,
      sceneItemId: parsed.data.sceneItemId,
      name: itemMeta.name ?? parsed.data.title,
    };

    const revealContent = parsed.data.content?.trim()
      || (compItem ? synthesizeCompendiumItemDescription(compItem) : '')
      || null;

    const handout = await upsertSceneItemHandout({
      campaignId: session.campaignId,
      sceneItemId: parsed.data.sceneItemId,
      title: parsed.data.title,
      content: revealContent,
      imageUrl: parsed.data.imageUrl,
      compendiumItemId: parsed.data.compendiumItemId,
      ddbDefinitionId,
      itemMeta,
    });

    const targetIds = await resolveRevealTargetsForSession(parsed.data.sessionId, parsed.data.targetUserIds);
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

    let pushResult: { ok: boolean; mode: string; message: string } | null = null;
    if (parsed.data.pushToDdb && receipts.length > 0) {
      try {
        const receipt = receipts.find((r) => r.userId === parsed.data.pushToDdb!.targetUserId) ?? receipts[0]!;
        pushResult = await pushReceiptToDdbForUser({
          receiptUserId: receipt.userId,
          receipt,
          ddbCharacterId: parsed.data.pushToDdb.ddbCharacterId,
          target: parsed.data.pushToDdb.target,
          campaignId: session.campaignId,
          gmUserId: userId,
        });
      } catch (pushErr) {
        pushResult = {
          ok: false,
          mode: 'failed',
          message: pushErr instanceof Error ? pushErr.message : 'D&D Beyond sync failed',
        };
      }
    }

    await readPrisma.sessionLog.create({
      data: {
        sessionId: parsed.data.sessionId,
        userId,
        type: 'HANDOUT_REVEAL',
        data: {
          handoutId: handout.id,
          sceneItemId: parsed.data.sceneItemId,
          title: handout.title,
          revealed: receipts.length,
        },
      },
    });

    res.json({ handout, receipts, revealed: receipts.length, pushResult });
  } catch (err) {
    console.error('[Handouts] scene reveal error:', err);
    res.status(500).json({ error: 'Failed to reveal scene handout' });
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

    const session = await readPrisma.gameSession.findUnique({
      where: { id: parsed.data.sessionId },
      select: { id: true, campaignId: true, isActive: true },
    });
    if (!session || session.campaignId !== handout.campaignId) {
      res.status(400).json({ error: 'Invalid session for this campaign' });
      return;
    }

    const targetIds = await resolveRevealTargetsForSession(parsed.data.sessionId, parsed.data.targetUserIds);
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

    await readPrisma.sessionLog.create({
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

    const handoutRow = await readPrisma.handout.findUnique({
      where: { id: receipt.handoutId },
      select: { campaignId: true },
    });
    if (!handoutRow) {
      res.status(404).json({ error: 'Handout not found' });
      return;
    }

    const gmMember = await readPrisma.campaignMember.findFirst({
      where: { campaignId: handoutRow.campaignId, role: 'GM' },
      select: { userId: true },
    });

    const result = await pushReceiptToDdbForUser({
      receiptUserId: userId,
      receipt,
      ddbCharacterId: parsed.data.ddbCharacterId,
      target: parsed.data.target,
      campaignId: handoutRow.campaignId,
      gmUserId: gmMember?.userId,
      descriptionOverride: parsed.data.description,
    });
    if (!result.ok) {
      res.json({
        ok: false,
        mode: result.mode,
        target: parsed.data.target,
        message: result.message ?? 'Failed to push item to D&D Beyond',
        manualFallback: inventoryManualFallback(parsed.data.ddbCharacterId, receipt, parsed.data.target),
      });
      return;
    }

    res.json({
      ok: true,
      mode: result.mode,
      target: parsed.data.target,
      message: result.message,
    });
  } catch (err) {
    console.error('[Handouts] add-to-inventory error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add item' });
  }
});

// POST /api/handouts/receipts/:id/gm-push-inventory — GM pushes item to DDB on a player's behalf
router.post('/receipts/:id/gm-push-inventory', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const gmUserId = req.userId!;
    const id = req.params['id'] as string;
    const receipt = await getReceipt(id);
    if (!receipt) {
      res.status(404).json({ error: 'Handout not found in journal' });
      return;
    }
    if (receipt.type !== 'ITEM_CARD') {
      res.status(400).json({ error: 'Only item card handouts can be added to inventory' });
      return;
    }

    const handoutRow = await readPrisma.handout.findUnique({
      where: { id: receipt.handoutId },
      select: { campaignId: true },
    });
    if (!handoutRow || !(await assertCampaignGM(handoutRow.campaignId, gmUserId))) {
      res.status(403).json({ error: 'Only the GM can push items for players' });
      return;
    }

    const parsed = addInventorySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request', details: parsed.error.flatten() });
      return;
    }

    const result = await pushReceiptToDdbForUser({
      receiptUserId: receipt.userId,
      receipt,
      ddbCharacterId: parsed.data.ddbCharacterId,
      target: parsed.data.target,
      campaignId: handoutRow.campaignId,
      gmUserId,
      descriptionOverride: parsed.data.description,
    });

    if (!result.ok) {
      res.json({
        ok: false,
        mode: result.mode,
        target: parsed.data.target,
        message: result.message ?? 'Failed to push item to D&D Beyond',
        manualFallback: inventoryManualFallback(parsed.data.ddbCharacterId, receipt, parsed.data.target),
      });
      return;
    }

    res.json({ ok: true, mode: result.mode, target: parsed.data.target, message: result.message });
  } catch (err) {
    console.error('[Handouts] gm-push-inventory error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to push item' });
  }
});

export default router;
