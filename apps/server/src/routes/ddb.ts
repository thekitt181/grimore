import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import { requireSessionMember } from '../middleware/requireSessionMember';
import {
  fetchDdbCampaigns,
  fetchDdbCharacterList,
  fetchDdbEncounters,
  getCobaltForUser,
  getDdbStatus,
  getOrSyncCharacter,
  linkDdbAccount,
  listDdbLibrarySources,
  browseDdbLibraryMonsters,
  previewDdbLibraryMonster,
  browseDdbLibrarySpells,
  browseDdbLibraryItems,
  importFromDdbLibrary,
  importAllFromDdbLibrarySource,
  patchCharacterHp,
  patchCharacterDeathSaves,
  unlinkDdbAccount,
} from '../services/ddb/ddbService';
import { fetchDdbImage, isAllowedDdbImageUrl } from '../services/ddb/imageProxy';

function parseSourceIds(query: Record<string, unknown>): number[] | undefined {
  const raw = query['sourceIds'];
  if (typeof raw === 'string' && raw.trim()) {
    const ids = raw
      .split(',')
      .map((part) => parseInt(part.trim(), 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  }
  if (Array.isArray(raw)) {
    const ids = raw
      .flatMap((part) => String(part).split(','))
      .map((part) => parseInt(part.trim(), 10))
      .filter((id) => Number.isFinite(id) && id > 0);
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  }
  const single = parseInt(String(query['sourceId'] ?? ''), 10);
  return Number.isFinite(single) && single > 0 ? [single] : undefined;
}
import { getRollBridgeDebug, fetchNewDdbRollsForSession } from '../services/ddb/ddbRollBridge';
const router = Router();

const linkSchema = z.object({ cobalt: z.string().min(10) });
const hpSchema = z.object({
  hp: z.number().int().min(0),
  tempHp: z.number().int().min(0).default(0),
  maxHp: z.number().int().min(1).optional(),
});
const deathSaveSchema = z.object({
  successes: z.number().int().min(0).max(3),
  failures: z.number().int().min(0).max(3),
  stabilized: z.boolean().optional(),
  hp: z.number().int().min(0).optional(),
  tempHp: z.number().int().min(0).optional(),
});
const campaignLinkSchema = z.object({ ddbCampaignId: z.number().int().positive() });

router.post('/link', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid Cobalt token' });
      return;
    }
    const status = await linkDdbAccount(req.userId!, parsed.data.cobalt);
    res.json(status);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Link failed' });
  }
});

router.get('/proxy-image', async (req, res) => {
  try {
    const url = typeof req.query['url'] === 'string' ? req.query['url'] : '';
    if (!url || !isAllowedDdbImageUrl(url)) {
      res.status(400).json({ error: 'Invalid image URL' });
      return;
    }
    const image = await fetchDdbImage(url, null);
    if (!image) {
      res.status(404).send('Not found');
      return;
    }
    res.setHeader('Content-Type', image.contentType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(image.body);
  } catch (err) {
    console.error('[DDB] proxy-image error:', err);
    res.status(502).json({ error: 'Failed to proxy image' });
  }
});

router.get('/status', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const status = await getDdbStatus(req.userId!);
    res.json(status);
  } catch (err) {
    console.error('[DDB] status error:', err);
    res.status(500).json({ error: 'Failed to check D&D Beyond status' });
  }
});

router.delete('/link', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    await unlinkDdbAccount(req.userId!);
    res.json({ linked: false });
  } catch (err) {
    console.error('[DDB] unlink error:', err);
    res.status(500).json({ error: 'Failed to disconnect' });
  }
});

router.get('/campaigns', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cobalt = await getCobaltForUser(req.userId!);
    if (!cobalt) {
      res.status(400).json({ error: 'D&D Beyond account not linked' });
      return;
    }
    const campaigns = await fetchDdbCampaigns(cobalt);
    res.json({ campaigns });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load campaigns' });
  }
});

router.get('/characters', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const cobalt = await getCobaltForUser(req.userId!);
    if (!cobalt) {
      res.status(400).json({ error: 'D&D Beyond account not linked' });
      return;
    }
    const characters = await fetchDdbCharacterList(cobalt);
    res.json({ characters });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load characters' });
  }
});

router.get('/characters/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid character id' });
      return;
    }
    const character = await getOrSyncCharacter(req.userId!, id);
    res.json({ character });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load character' });
  }
});

router.post('/characters/:id/sync', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid character id' });
      return;
    }
    const character = await getOrSyncCharacter(req.userId!, id, true);
    res.json({ character });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Sync failed' });
  }
});

router.post('/characters/:id/import-token', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid character id' });
      return;
    }
    const character = await getOrSyncCharacter(req.userId!, id, true);
    const dex = character.abilities.find((a) => a.name === 'DEX');
    res.json({
      character,
      tokenDefaults: {
        name: character.name,
        imageUrl: character.avatarUrl,
        hp: character.hp,
        maxHp: character.maxHp,
        tempHp: character.tempHp,
        ac: character.ac,
        initiativeMod: dex?.mod ?? 0,
        sizeCells: 1,
        ddbCharacterId: id,
        isPc: true,
        ownerId: req.userId,
        syncHpToDdb: true,
        hideHpFromPlayers: false,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

router.patch('/characters/:id/hp', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid character id' });
      return;
    }
    const parsed = hpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid HP payload' });
      return;
    }
    const { hp, tempHp } = parsed.data;
    const result = await patchCharacterHp(req.userId!, id, hp, tempHp);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'HP update failed' });
  }
});

router.patch('/characters/:id/death-saves', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid character id' });
      return;
    }
    const parsed = deathSaveSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid death save payload' });
      return;
    }
    const { successes, failures, stabilized, hp, tempHp } = parsed.data;
    const result = await patchCharacterDeathSaves(
      req.userId!,
      id,
      { successes, failures, stabilized },
      hp != null || tempHp != null ? { hp, tempHp } : undefined,
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Death save update failed' });
  }
});

router.post('/campaigns/:campaignId/link', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const campaignId = req.params['campaignId'] ?? '';
    const parsed = campaignLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const member = await prisma.campaignMember.findFirst({
      where: { campaignId, userId: req.userId!, role: 'GM' },
    });
    if (!member) {
      res.status(403).json({ error: 'Only the GM can link D&D Beyond campaigns' });
      return;
    }

    const link = await prisma.ddbCampaignLink.upsert({
      where: { campaignId },
      create: { campaignId, ddbCampaignId: parsed.data.ddbCampaignId },
      update: { ddbCampaignId: parsed.data.ddbCampaignId, linkedAt: new Date() },
    });

    res.json({ link });
  } catch (err) {
    console.error('[DDB] campaign link error:', err);
    res.status(500).json({ error: 'Failed to link campaign' });
  }
});

router.get('/campaigns/:campaignId/ddb-link', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const campaignId = req.params['campaignId'] ?? '';
    const link = await prisma.ddbCampaignLink.findUnique({ where: { campaignId } });
    res.json({ link: link ?? null });
  } catch (err) {
    console.error('[DDB] ddb-link error:', err);
    res.status(500).json({ error: 'Failed to fetch link' });
  }
});

router.get('/campaigns/:ddbCampaignId/encounters', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const ddbCampaignId = parseInt(req.params['ddbCampaignId'] ?? '', 10);
    if (!Number.isFinite(ddbCampaignId)) {
      res.status(400).json({ error: 'Invalid campaign id' });
      return;
    }
    const cobalt = await getCobaltForUser(req.userId!);
    if (!cobalt) {
      res.status(400).json({ error: 'D&D Beyond account not linked' });
      return;
    }
    const encounters = await fetchDdbEncounters(cobalt, ddbCampaignId);
    res.json({ encounters });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load encounters' });
  }
});

router.post('/encounters/:id/summon', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const encounterId = req.params['id'] ?? '';
    const { ddbCampaignId } = req.body as { ddbCampaignId?: number };
    if (!ddbCampaignId) {
      res.status(400).json({ error: 'ddbCampaignId required' });
      return;
    }
    const cobalt = await getCobaltForUser(req.userId!);
    if (!cobalt) {
      res.status(400).json({ error: 'D&D Beyond account not linked' });
      return;
    }
    const encounters = await fetchDdbEncounters(cobalt, ddbCampaignId);
    const encounter = encounters.find((e) => e.id === encounterId);
    if (!encounter) {
      res.status(404).json({ error: 'Encounter not found' });
      return;
    }
    res.json({ encounter, monsters: encounter.monsters });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Summon prep failed' });
  }
});

router.patch('/settings', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const schema = z.object({
      syncHpToDdb: z.boolean().optional(),
      rollBridgeEnabled: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid settings' });
      return;
    }
    const conn = await prisma.ddbConnection.findUnique({ where: { userId: req.userId! } });
    if (!conn) {
      res.status(400).json({ error: 'Not linked' });
      return;
    }
    const updated = await prisma.ddbConnection.update({
      where: { userId: req.userId! },
      data: {
        ...(parsed.data.syncHpToDdb !== undefined ? { syncHpToDdb: parsed.data.syncHpToDdb } : {}),
        ...(parsed.data.rollBridgeEnabled !== undefined
          ? { rollBridgeEnabled: parsed.data.rollBridgeEnabled }
          : {}),
      },
    });
    res.json({
      syncHpToDdb: updated.syncHpToDdb,
      rollBridgeEnabled: updated.rollBridgeEnabled,
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

router.get('/bridge/:sessionId', requireAuth, async (req: AuthenticatedRequest, res) => {
  const sessionId = req.params['sessionId'];
  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId' });
    return;
  }
  res.json(getRollBridgeDebug(sessionId) ?? { active: false, pollSeeded: false, seenCount: 0 });
});

router.get('/sessions/:sessionId/rolls/poll', requireAuth, requireSessionMember, async (req: AuthenticatedRequest, res) => {
  const sessionId = req.params['sessionId'];
  if (!sessionId) {
    res.status(400).json({ error: 'Missing sessionId' });
    return;
  }
  if (sessionId !== req.header('x-session-id')) {
    res.status(403).json({ error: 'Session mismatch' });
    return;
  }
  try {
    const rolls = await fetchNewDdbRollsForSession(sessionId);
    res.json({ rolls });
  } catch (err) {
    console.error('[DDB] roll poll failed:', err);
    res.status(500).json({ error: 'Roll poll failed' });
  }
});

router.get('/library/sources', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const sources = await listDdbLibrarySources(req.userId!);
    res.json({ sources });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Failed to load sources' });
  }
});

router.get('/library/monsters', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined;
    const sourceIds = parseSourceIds(req.query as Record<string, unknown>);
    const skip = parseInt(String(req.query['skip'] ?? '0'), 10);
    const take = parseInt(String(req.query['take'] ?? '40'), 10);
    const result = await browseDdbLibraryMonsters(req.userId!, {
      q,
      ...(sourceIds ? { sourceIds } : {}),
      skip: Number.isFinite(skip) ? skip : 0,
      take: Number.isFinite(take) ? take : 40,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Monster search failed' });
  }
});

router.get('/library/monsters/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const id = parseInt(req.params['id'] ?? '', 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid monster id' });
      return;
    }
    const monster = await previewDdbLibraryMonster(req.userId!, id);
    res.json({ monster });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Monster preview failed' });
  }
});

router.get('/library/spells', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined;
    const sourceIds = parseSourceIds(req.query as Record<string, unknown>);
    const campaignId = parseInt(String(req.query['campaignId'] ?? ''), 10);
    const limit = parseInt(String(req.query['limit'] ?? '80'), 10);
    const items = await browseDdbLibrarySpells(req.userId!, {
      q,
      ...(sourceIds ? { sourceIds } : {}),
      ...(Number.isFinite(campaignId) ? { campaignId } : {}),
      limit: Number.isFinite(limit) ? limit : 80,
    });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Spell search failed' });
  }
});

router.get('/library/items', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const q = typeof req.query['q'] === 'string' ? req.query['q'] : undefined;
    const sourceIds = parseSourceIds(req.query as Record<string, unknown>);
    const campaignId = parseInt(String(req.query['campaignId'] ?? ''), 10);
    const limit = parseInt(String(req.query['limit'] ?? '80'), 10);
    const items = await browseDdbLibraryItems(req.userId!, {
      q,
      ...(sourceIds ? { sourceIds } : {}),
      ...(Number.isFinite(campaignId) ? { campaignId } : {}),
      limit: Number.isFinite(limit) ? limit : 80,
    });
    res.json({ items });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Item search failed' });
  }
});

const importSchema = z.object({
  kind: z.enum(['monster', 'item', 'spell']),
  ids: z.array(z.number().int().positive()).min(1).max(50),
  campaignId: z.number().int().positive().optional(),
  sourceId: z.number().int().positive().optional(),
});

router.post('/library/import', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = importSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid import payload' });
      return;
    }
    const result = await importFromDdbLibrary(req.userId!, parsed.data);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

const importAllSchema = z
  .object({
    sourceIds: z.array(z.coerce.number().int().positive()).optional(),
    sourceId: z.coerce.number().int().positive().optional(),
    campaignId: z.coerce.number().int().positive().optional(),
  })
  .transform((data) => {
    const sourceIds = [...new Set([...(data.sourceIds ?? []), ...(data.sourceId != null ? [data.sourceId] : [])])];
    return {
      sourceIds,
      ...(data.campaignId != null ? { campaignId: data.campaignId } : {}),
    };
  })
  .refine((data) => data.sourceIds.length > 0, {
    message: 'Select at least one source book',
  });

router.post('/library/import-all', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const parsed = importAllSchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues[0]?.message ?? 'Invalid import-all payload';
      res.status(400).json({ error: detail });
      return;
    }
    const result = await importAllFromDdbLibrarySource(req.userId!, parsed.data);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Import failed' });
  }
});

export default router;
