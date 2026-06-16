import { Container, Sprite, Texture, VideoSource } from 'pixi.js';
import type { ActiveSpellEffect } from '@grimoire/shared';
import type { AoePlacement } from '@/systems/combat/aoeGeometry';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { feetToPixels } from '@/systems/combat/aoeGeometry';
import { getMapGridSize } from '@/systems/combat/evaluateAttack';
import { useItemStore } from '@/systems/scene/store/itemStore';
import {
  applyJb2aShotIndex,
  jb2aAssetUrl,
  pickBeamVariantForWorldSpan,
  pickJb2aVariant,
  resolveSpellJb2aMapping,
  type Jb2aEffectAsset,
} from './jb2aAssets';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { placementFromCasterToTarget, placementOnToken } from './spellCastPlacement';
import { resolveShotPlacementsForEffect, placementTravelWorldSpan } from './spellVfxScreenUtils';

const CAST_LAYER_LABEL = 'spell-vfx-cast';
const ZONE_LAYER_LABEL = 'spell-vfx-zone';

interface ActiveCast {
  sprite: Sprite;
  source: VideoSource;
  cleanup: () => void;
}

const activeCasts = new Set<ActiveCast>();
const zoneSprites = new Map<string, { sprite: Sprite; source: VideoSource; video: HTMLVideoElement }>();

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0 && video.videoHeight > 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const finish = () => {
      if (video.videoWidth > 0 && video.videoHeight > 0) resolve();
    };
    video.addEventListener('loadeddata', finish, { once: true });
    video.addEventListener('loadedmetadata', finish, { once: true });
    video.addEventListener('error', () => reject(new Error('Video failed to load')), { once: true });
  });
}

function detachVideoSprite(
  layer: Container | null,
  sprite: Sprite,
  source: VideoSource,
  video: HTMLVideoElement,
): void {
  try {
    video.pause();
    video.removeAttribute('src');
    video.load();
  } catch {
    /* ignore teardown races */
  }
  if (layer && !sprite.destroyed) {
    layer.removeChild(sprite);
  }
  if (!sprite.destroyed) {
    // Destroy source explicitly — avoid textureSource:true (double-destroy → null.paused).
    sprite.destroy({ texture: true, textureSource: false });
  }
  if (!source.destroyed) {
    try {
      source.destroy();
    } catch {
      /* PIXI VideoSource can throw if the element was already torn down */
    }
  }
}

function getOverlay(): Container | null {
  return sceneRefs.overlay.current;
}

function ensureLayer(label: string): Container {
  const overlay = getOverlay();
  if (!overlay) throw new Error('Map overlay not ready');

  let layer = overlay.getChildByLabel(label) as Container | null;
  if (!layer || layer.destroyed) {
    layer = new Container();
    layer.label = label;
    layer.eventMode = 'none';
    overlay.addChild(layer);
  }
  return layer;
}

function targetSizePx(effect: ActiveSpellEffect, asset: Jb2aEffectAsset): number {
  const grid = getMapGridSize();
  const aoe = effect.aoe!;
  const type = aoe.type.toLowerCase();
  if (asset.directed && effect.placement) {
    return feetToPixels((placementTravelWorldSpan(effect.placement) / grid) * 5, grid);
  }
  const sizePx = feetToPixels(aoe.size, grid);

  if (type === 'line') return sizePx;
  if (type === 'cone') return sizePx;
  return sizePx * 2;
}

function pickCastVariant(
  effect: ActiveSpellEffect,
  asset: Jb2aEffectAsset,
  placement: AoePlacement,
): ReturnType<typeof pickJb2aVariant> {
  if (asset.directed) {
    return pickBeamVariantForWorldSpan(asset, placementTravelWorldSpan(placement), getMapGridSize());
  }
  return pickJb2aVariant(asset, targetSizePx(effect, asset));
}

function scaleForEffect(effect: ActiveSpellEffect, asset: Jb2aEffectAsset, variant: ReturnType<typeof pickJb2aVariant>): number {
  const targetPx = targetSizePx(effect, asset);
  const native = asset.directed
    ? Math.max(variant.width, 1)
    : Math.max(variant.width, variant.height);
  return native > 0 ? targetPx / native : 1;
}

async function createVideoSprite(
  url: string,
  loop: boolean,
): Promise<{ sprite: Sprite; source: VideoSource; video: HTMLVideoElement }> {
  const video = document.createElement('video');
  video.src = url;
  video.crossOrigin = 'anonymous';
  video.muted = true;
  video.playsInline = true;
  video.loop = loop;
  video.preload = 'auto';

  await waitForVideoMetadata(video);

  const source = new VideoSource({
    resource: video,
    autoPlay: true,
    muted: true,
    loop,
    crossorigin: 'anonymous',
  });

  await source.load();
  if (video.videoWidth <= 0 || video.videoHeight <= 0) {
    source.destroy();
    throw new Error('Video has no frame dimensions');
  }
  const texture = new Texture({ source });
  const sprite = new Sprite(texture);
  sprite.anchor.set(0.5);
  sprite.eventMode = 'none';
  sprite.blendMode = 'screen';

  void video.play().catch(() => {
    /* autoplay blocked — still shows first frame when allowed */
  });

  return { sprite, source, video };
}

function positionSpriteAt(
  sprite: Sprite,
  placement: AoePlacement,
  effect: ActiveSpellEffect,
  asset: Jb2aEffectAsset,
  variant: ReturnType<typeof pickJb2aVariant>,
): void {
  const scale = scaleForEffect(effect, asset, variant);
  sprite.scale.set(scale);
  if (asset.directed) {
    sprite.anchor.set(0, 0.5);
  } else {
    sprite.anchor.set(0.5, 0.5);
  }
  sprite.x = asset.directed ? placement.originX : placement.centerX;
  sprite.y = asset.directed ? placement.originY : placement.centerY;
  if (asset.directed) {
    sprite.rotation = placement.angleRad;
  }
}

function positionSprite(
  sprite: Sprite,
  effect: ActiveSpellEffect,
  asset: Jb2aEffectAsset,
  variant: ReturnType<typeof pickJb2aVariant>,
): void {
  positionSpriteAt(sprite, effect.placement!, effect, asset, variant);
}

async function spawnCastSprite(
  layer: Container,
  effect: ActiveSpellEffect,
  asset: Jb2aEffectAsset,
  variant: ReturnType<typeof pickJb2aVariant>,
  url: string,
  placement: AoePlacement,
): Promise<void> {
  const { sprite, source, video } = await createVideoSprite(url, false);
  positionSpriteAt(sprite, placement, effect, asset, variant);
  layer.addChild(sprite);

  const cast: ActiveCast = {
    sprite,
    source,
    cleanup: () => {},
  };

  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    video.removeEventListener('ended', finish);
    detachVideoSprite(layer, sprite, source, video);
    activeCasts.delete(cast);
  };
  cast.cleanup = finish;

  activeCasts.add(cast);
  video.addEventListener('ended', finish, { once: true });
  window.setTimeout(finish, variant.durationMs + 250);
}

export async function playSpellCastVfx(
  effect: ActiveSpellEffect,
  baseUrl: string,
): Promise<void> {
  if (!effect.placement || !effect.aoe || !baseUrl.trim()) return;

  const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe.type);
  const asset = mapping.cast ?? mapping.zone;
  if (!asset) return;

  try {
    const layer = ensureLayer(CAST_LAYER_LABEL);
    const items = useItemStore.getState().items;
    const liveById = useLiveTransformStore.getState().byId;
    const placements = resolveShotPlacementsForEffect(effect, items, liveById, Boolean(asset.directed));

    if (placements.length > 0) {
      for (let i = 0; i < placements.length; i++) {
        const placement = placements[i]!;
        const variant = applyJb2aShotIndex(
          pickCastVariant(effect, asset, placement),
          i,
        );
        const url = jb2aAssetUrl(baseUrl, asset, variant);
        await spawnCastSprite(layer, effect, asset, variant, url, placement);
        if (i < placements.length - 1) {
          await new Promise((r) => window.setTimeout(r, 120));
        }
      }
      return;
    }

    const placement = effect.placement;
    const variant = pickCastVariant(effect, asset, placement);
    const url = jb2aAssetUrl(baseUrl, asset, variant);
    await spawnCastSprite(layer, effect, asset, variant, url, placement);
  } catch {
    /* missing assets or CORS — gold polygon fallback remains */
  }
}

export async function syncZoneLoopVfx(
  effects: ActiveSpellEffect[],
  baseUrl: string,
): Promise<void> {
  if (!baseUrl.trim()) {
    clearZoneLoopVfx();
    return;
  }

  const layer = ensureLayer(ZONE_LAYER_LABEL);
  const keep = new Set<string>();

  for (const effect of effects) {
    if (!effect.placement || !effect.aoe) continue;
    const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe.type);
    const asset = mapping.zone;
    if (!asset) continue;

    keep.add(effect.id);

    if (zoneSprites.has(effect.id)) {
      const existing = zoneSprites.get(effect.id)!;
      positionSprite(
        existing.sprite,
        effect,
        asset,
        pickJb2aVariant(asset, targetSizePx(effect, asset)),
      );
      continue;
    }

    const variant = pickJb2aVariant(asset, targetSizePx(effect, asset));
    const url = jb2aAssetUrl(baseUrl, asset, variant);

    try {
      const { sprite, source, video } = await createVideoSprite(url, true);
      positionSprite(sprite, effect, asset, variant);
      sprite.alpha = 0.85;
      layer.addChild(sprite);
      zoneSprites.set(effect.id, { sprite, source, video });
    } catch {
      /* skip this zone */
    }
  }

  for (const [id, { sprite, source, video }] of zoneSprites) {
    if (keep.has(id)) continue;
    detachVideoSprite(layer, sprite, source, video);
    zoneSprites.delete(id);
  }
}

export function clearCastVfx(): void {
  for (const cast of [...activeCasts]) {
    cast.cleanup();
  }
}

export function clearZoneLoopVfx(): void {
  const layer = getOverlay()?.getChildByLabel(ZONE_LAYER_LABEL) as Container | null;
  for (const [id, { sprite, source, video }] of zoneSprites) {
    detachVideoSprite(layer, sprite, source, video);
    zoneSprites.delete(id);
  }
}

export function clearAllSpellVideoVfx(): void {
  clearCastVfx();
  clearZoneLoopVfx();
}
