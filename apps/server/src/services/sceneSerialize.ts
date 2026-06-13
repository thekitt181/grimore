import {
  DEFAULT_SCENE_MEDIA_CONFIG as defaultMedia,
  type GameMapRecord,
  type SceneMediaConfig,
  type SceneRecord,
  type SceneTransition,
} from '@grimoire/shared';
import type { Prisma } from '@prisma/client';

function parseMediaConfig(raw: unknown): SceneMediaConfig {
  if (!raw || typeof raw !== 'object') return { ...defaultMedia };
  const cfg = raw as Partial<SceneMediaConfig>;
  return {
    ambientLayers: Array.isArray(cfg.ambientLayers) ? cfg.ambientLayers : [],
    musicPlaylist: Array.isArray(cfg.musicPlaylist) ? cfg.musicPlaylist : [],
    musicMode: cfg.musicMode ?? 'crossfade',
    masterVolume: typeof cfg.masterVolume === 'number' ? cfg.masterVolume : 0.85,
    videoPopup: cfg.videoPopup ?? null,
  };
}

export function serializeGameMap(map: {
  id: string;
  campaignId: string;
  name: string;
  imageUrl: string;
  gridType: string;
  gridSize: number;
  scale: string;
  width: number;
  height: number;
  tags: string[];
  walls: unknown;
  createdAt: Date;
  updatedAt: Date;
}): GameMapRecord {
  return {
    id: map.id,
    campaignId: map.campaignId,
    name: map.name,
    imageUrl: map.imageUrl,
    gridType: map.gridType as GameMapRecord['gridType'],
    gridSize: map.gridSize,
    scale: map.scale,
    width: map.width,
    height: map.height,
    tags: map.tags,
    walls: map.walls,
    createdAt: map.createdAt.toISOString(),
    updatedAt: map.updatedAt.toISOString(),
  };
}

export function serializeScene(scene: {
  id: string;
  campaignId: string;
  name: string;
  mapId: string | null;
  ambientAudioUrl: string | null;
  backgroundVideoUrl: string | null;
  lightingPreset: string;
  weatherOverlay: string | null;
  timeOfDay?: string | null;
  mediaConfig: unknown;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  map?: Parameters<typeof serializeGameMap>[0] | null;
}): SceneRecord {
  return {
    id: scene.id,
    campaignId: scene.campaignId,
    name: scene.name,
    mapId: scene.mapId,
    ambientAudioUrl: scene.ambientAudioUrl,
    backgroundVideoUrl: scene.backgroundVideoUrl,
    lightingPreset: scene.lightingPreset as SceneRecord['lightingPreset'],
    weatherOverlay: (scene.weatherOverlay ?? null) as SceneRecord['weatherOverlay'],
    timeOfDay: (scene.timeOfDay ?? 'day') as SceneRecord['timeOfDay'],
    mediaConfig: parseMediaConfig(scene.mediaConfig),
    sortOrder: scene.sortOrder,
    createdAt: scene.createdAt.toISOString(),
    updatedAt: scene.updatedAt.toISOString(),
    ...(scene.map ? { map: serializeGameMap(scene.map) } : {}),
  };
}

export function mediaConfigInput(
  partial?: Partial<SceneMediaConfig>,
): Prisma.InputJsonValue {
  const base = { ...defaultMedia, ...partial };
  return base as unknown as Prisma.InputJsonValue;
}

export function sceneIncludeMap() {
  return { map: true } as const;
}

export type SceneTransitionArg = SceneTransition;
