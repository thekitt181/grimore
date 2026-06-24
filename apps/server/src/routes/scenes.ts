import { Router } from 'express';
import { z } from 'zod';
import { readPrisma } from '../lib/prisma';
import { isDbPoolSaturation, withDbTimeout } from '../lib/dbTimeout';
import { requireAuth, type AuthenticatedRequest } from '../middleware/auth';
import {
  mediaConfigInput,
  sceneIncludeMap,
  serializeGameMap,
  serializeScene,
} from '../services/sceneSerialize';
import type { Prisma } from '@prisma/client';

const router = Router();

const SCENE_DB_TIMEOUT_MS = 10_000;

function respondSceneDbError(
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

const lightingPresetSchema = z.enum([
  'default', 'torchlight', 'moonlight', 'overcast', 'underdark', 'ethereal', 'blood-moon',
]);
const weatherSchema = z.enum([
  'none', 'rain', 'heavy-rain', 'snow', 'blizzard', 'fog', 'mist', 'storm', 'hail',
  'sandstorm', 'swamp', 'ash', 'embers', 'leaves', 'fireflies', 'aurora',
]).nullable().optional();
const timeOfDaySchema = z.enum([
  'dawn', 'day', 'golden-hour', 'dusk', 'night', 'midnight',
]).nullable().optional();
const gameTimeSchema = z.object({
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
}).nullable().optional();
const transitionSchema = z.enum(['fade', 'fire', 'page-turn', 'none']);

const audioLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  volume: z.number().min(0).max(1),
  loop: z.boolean(),
  libraryId: z.string().optional(),
  category: z.string().optional(),
});

const musicTrackSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  volume: z.number().min(0).max(1),
  libraryId: z.string().optional(),
});

const mediaConfigSchema = z.object({
  ambientLayers: z.array(audioLayerSchema).optional(),
  musicPlaylist: z.array(musicTrackSchema).optional(),
  musicMode: z.enum(['single', 'playlist', 'crossfade']).optional(),
  masterVolume: z.number().min(0).max(1).optional(),
  videoPopup: z.object({
    url: z.string(),
    loop: z.boolean(),
    muted: z.boolean(),
    autoplay: z.boolean(),
    showAsOverlay: z.boolean(),
    cinemaMode: z.boolean().optional(),
    volume: z.number().min(0).max(1).optional(),
  }).nullable().optional(),
}).optional();

const createSceneSchema = z.object({
  name: z.string().min(1).max(120),
  mapId: z.string().nullable().optional(),
  ambientAudioUrl: z.string().nullable().optional(),
  backgroundVideoUrl: z.string().nullable().optional(),
  lightingPreset: lightingPresetSchema.optional(),
  weatherOverlay: weatherSchema,
  timeOfDay: timeOfDaySchema,
  gameTime: gameTimeSchema,
  mediaConfig: mediaConfigSchema,
  items: z.array(z.any()).optional(),
  activeMapId: z.string().nullable().optional(),
  fogData: z.any().optional(),
});

const createMapSchema = z.object({
  name: z.string().min(1).max(120),
  imageUrl: z.string().min(1),
  gridType: z.enum(['SQUARE', 'HEX']).optional(),
  gridSize: z.number().int().min(4).max(400).optional(),
  scale: z.string().optional(),
  width: z.number().int().min(0).optional(),
  height: z.number().int().min(0).optional(),
  tags: z.array(z.string()).optional(),
  walls: z.unknown().optional(),
});

async function assertCampaignMember(campaignId: string, userId: string, gmOnly = false) {
  const campaign = await readPrisma.campaign.findUnique({
    where: { id: campaignId },
    select: { gmId: true, members: { where: { userId }, select: { role: true } } },
  });
  if (!campaign) return { ok: false as const, status: 404, error: 'Campaign not found' };
  const member = campaign.members[0];
  if (!member) return { ok: false as const, status: 403, error: 'Access denied' };
  if (gmOnly && campaign.gmId !== userId) {
    return { ok: false as const, status: 403, error: 'GM only' };
  }
  return { ok: true as const, campaign };
}

// GET /api/scenes/campaign/:campaignId
router.get('/campaign/:campaignId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const access = await withDbTimeout(
      SCENE_DB_TIMEOUT_MS,
      () => assertCampaignMember(campaignId, userId),
      'scenes.access',
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const scenes = await withDbTimeout(
      SCENE_DB_TIMEOUT_MS,
      () =>
        readPrisma.scene.findMany({
          where: { campaignId },
          include: sceneIncludeMap(),
          orderBy: { sortOrder: 'asc' },
        }),
      'scenes.list',
    );
    res.json({ scenes: scenes.map(serializeScene) });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] list error:', 'Failed to list scenes');
  }
});

// GET /api/scenes/campaign/:campaignId/maps
router.get('/campaign/:campaignId/maps', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const access = await withDbTimeout(
      SCENE_DB_TIMEOUT_MS,
      () => assertCampaignMember(campaignId, userId),
      'scenes.maps.access',
    );
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const maps = await withDbTimeout(
      SCENE_DB_TIMEOUT_MS,
      () =>
        readPrisma.gameMap.findMany({
          where: { campaignId },
          orderBy: { createdAt: 'desc' },
        }),
      'scenes.maps.list',
    );
    res.json({ maps: maps.map(serializeGameMap) });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] maps list error:', 'Failed to list maps');
  }
});

// POST /api/scenes/campaign/:campaignId/maps
router.post('/campaign/:campaignId/maps', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const access = await assertCampaignMember(campaignId, userId, true);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const parsed = createMapSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    const map = await readPrisma.gameMap.create({
      data: {
        campaignId,
        name: data.name,
        imageUrl: data.imageUrl,
        gridType: data.gridType ?? 'SQUARE',
        gridSize: data.gridSize ?? 50,
        scale: data.scale ?? '5ft',
        width: data.width ?? 0,
        height: data.height ?? 0,
        tags: data.tags ?? [],
        walls: (data.walls ?? []) as Prisma.InputJsonValue,
      },
    });
    res.status(201).json({ map: serializeGameMap(map) });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] create map error:', 'Failed to create map');
  }
});

// POST /api/scenes/campaign/:campaignId
router.post('/campaign/:campaignId', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const campaignId = req.params['campaignId'] as string;
    const access = await assertCampaignMember(campaignId, userId, true);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const parsed = createSceneSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }

    const maxOrder = await readPrisma.scene.aggregate({
      where: { campaignId },
      _max: { sortOrder: true },
    });
    const data = parsed.data;
    const scene = await readPrisma.scene.create({
      data: {
        campaignId,
        name: data.name,
        mapId: data.mapId ?? null,
        ambientAudioUrl: data.ambientAudioUrl ?? null,
        backgroundVideoUrl: data.backgroundVideoUrl ?? null,
        lightingPreset: data.lightingPreset ?? 'default',
        weatherOverlay: data.weatherOverlay ?? null,
        timeOfDay: data.timeOfDay ?? 'day',
        gameTimeHour: data.gameTime?.hour ?? 12,
        gameTimeMinute: data.gameTime?.minute ?? 0,
        mediaConfig: mediaConfigInput(data.mediaConfig),
        items: (data.items ?? []) as Prisma.InputJsonValue,
        activeMapId: data.activeMapId ?? null,
        fogData: data.fogData ?? null,
        sortOrder: (maxOrder._max.sortOrder ?? -1) + 1,
      },
      include: sceneIncludeMap(),
    });
    res.status(201).json({ scene: serializeScene(scene) });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] create error:', 'Failed to create scene');
  }
});

// PATCH /api/scenes/:id
router.patch('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const existing = await readPrisma.scene.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Scene not found' });
      return;
    }
    const access = await assertCampaignMember(existing.campaignId, userId, true);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }

    const parsed = createSceneSchema.partial().extend({
      sortOrder: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid body', details: parsed.error.flatten() });
      return;
    }

    const data = parsed.data;
    const scene = await readPrisma.scene.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.mapId !== undefined ? { mapId: data.mapId } : {}),
        ...(data.ambientAudioUrl !== undefined ? { ambientAudioUrl: data.ambientAudioUrl } : {}),
        ...(data.backgroundVideoUrl !== undefined ? { backgroundVideoUrl: data.backgroundVideoUrl } : {}),
        ...(data.lightingPreset !== undefined ? { lightingPreset: data.lightingPreset } : {}),
        ...(data.weatherOverlay !== undefined ? { weatherOverlay: data.weatherOverlay } : {}),
        ...(data.timeOfDay !== undefined ? { timeOfDay: data.timeOfDay ?? 'day' } : {}),
        ...(data.gameTime !== undefined ? {
          gameTimeHour: data.gameTime?.hour ?? 12,
          gameTimeMinute: data.gameTime?.minute ?? 0,
        } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        ...(data.mediaConfig !== undefined ? { mediaConfig: mediaConfigInput(data.mediaConfig) } : {}),
        ...(data.items !== undefined ? { items: data.items as Prisma.InputJsonValue } : {}),
        ...(data.activeMapId !== undefined ? { activeMapId: data.activeMapId } : {}),
        ...(data.fogData !== undefined ? { fogData: data.fogData as Prisma.InputJsonValue } : {}),
      },
      include: sceneIncludeMap(),
    });
    res.json({ scene: serializeScene(scene) });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] update error:', 'Failed to update scene');
  }
});

// DELETE /api/scenes/:id
router.delete('/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const existing = await readPrisma.scene.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'Scene not found' });
      return;
    }
    const access = await assertCampaignMember(existing.campaignId, userId, true);
    if (!access.ok) {
      res.status(access.status).json({ error: access.error });
      return;
    }
    await readPrisma.scene.delete({ where: { id } });
    res.json({ ok: true });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] delete error:', 'Failed to delete scene');
  }
});

// POST /api/scenes/:id/activate — set active scene on a live session
router.post('/:id/activate', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const id = req.params['id'] as string;
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : null;
    const transition = transitionSchema.safeParse(req.body?.transition ?? 'fade');
    if (!sessionId) {
      res.status(400).json({ error: 'sessionId required' });
      return;
    }

    const scene = await readPrisma.scene.findUnique({
      where: { id },
      include: sceneIncludeMap(),
    });
    if (!scene) {
      res.status(404).json({ error: 'Scene not found' });
      return;
    }

    const session = await readPrisma.gameSession.findUnique({
      where: { id: sessionId },
      include: { campaign: { select: { gmId: true } } },
    });
    if (!session || session.campaignId !== scene.campaignId) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    if (session.campaign.gmId !== userId) {
      res.status(403).json({ error: 'GM only' });
      return;
    }

    await readPrisma.gameSession.update({
      where: { id: sessionId },
      data: { activeSceneId: id },
    });
    await readPrisma.sessionLog.create({
      data: {
        sessionId,
        userId,
        type: 'SCENE_CHANGE',
        data: { sceneId: id, transition: transition.success ? transition.data : 'fade' },
      },
    });

    res.json({
      scene: serializeScene(scene),
      transition: transition.success ? transition.data : 'fade',
    });
  } catch (err) {
    respondSceneDbError(res, err, '[Scenes] activate error:', 'Failed to activate scene');
  }
});

export default router;
