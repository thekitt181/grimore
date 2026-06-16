import type { ActiveSpellEffect } from '@grimoire/shared';
import type { AoePlacement } from '@/systems/combat/aoeGeometry';
import type { LiveTransform } from '@/systems/scene/store/liveTransformStore';
import type { Item } from '@/systems/scene/types';
import { feetToPixels } from '@/systems/combat/aoeGeometry';
import { getMapGridSize } from '@/systems/combat/evaluateAttack';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
import { worldXZToClientScreen } from '@/systems/map3d/perspectiveCameraSync';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { Jb2aEffectAsset, Jb2aVariant } from './jb2aAssets';
import {
  pickBeamVariantForWorldSpan,
  pickJb2aVariant,
  parseVariantFeet,
  resolveSpellJb2aMapping,
  withBeamVariants,
} from './jb2aAssets';
import { placementFromCasterToTargetLive, placementOnTokenLive } from './spellCastPlacement';
import { resolveShotTargetIds } from './spellLevelScaling';

export interface ScreenBeamLayout {
  x: number;
  y: number;
  width: number;
  height: number;
  angleRad: number;
  variant: Jb2aVariant;
}

/** Spell VFX must render above the Three.js canvas (Pixi overlay sits underneath it). */
export function spellVfxUsesScreenLayer(): boolean {
  if (useMapStore.getState().viewMode === '3d') return true;
  return sceneRefs.threeCanvas.current != null;
}

export function projectWorldPoint(wx: number, wz: number): { x: number; y: number } | null {
  const rect = getPickCanvasRect();
  if (!rect) return null;
  return worldXZToClientScreen(wx, wz, rect);
}

export function worldSpanToScreenPx(wx: number, wz: number, worldSpan: number): number {
  const a = projectWorldPoint(wx, wz);
  const b = projectWorldPoint(wx + worldSpan, wz);
  if (!a || !b) return 80;
  return Math.max(24, Math.hypot(b.x - a.x, b.y - a.y));
}

export function placementWorldPoint(
  placement: AoePlacement,
  directed: boolean,
): { x: number; z: number } {
  return directed
    ? { x: placement.originX, z: placement.originY }
    : { x: placement.centerX, z: placement.centerY };
}

export function placementTravelWorldSpan(placement: AoePlacement): number {
  return Math.hypot(
    placement.centerX - placement.originX,
    placement.centerY - placement.originY,
  );
}

export function resolveDirectedBeamLayout(
  placement: AoePlacement,
  asset: Jb2aEffectAsset,
  minLengthPx = 48,
): ScreenBeamLayout | null {
  const start = projectWorldPoint(placement.originX, placement.originY);
  const end = projectWorldPoint(placement.centerX, placement.centerY);
  if (!start || !end) return null;

  const grid = getMapGridSize();
  const worldSpan = placementTravelWorldSpan(placement);
  if (worldSpan < grid * 0.1) return null;

  const enriched = withBeamVariants(asset);
  const variant = pickBeamVariantForWorldSpan(enriched, worldSpan, grid);
  const variantFeet = parseVariantFeet(variant.suffix) ?? (worldSpan / grid) * 5;
  const beamWorldPx = feetToPixels(variantFeet, grid);
  let lengthPx = worldSpanToScreenPx(placement.originX, placement.originY, beamWorldPx);
  lengthPx = Math.max(lengthPx, minLengthPx);

  const aspect = variant.height / Math.max(variant.width, 1);
  const heightPx = Math.max(12, lengthPx * aspect);
  const angleRad = Math.atan2(end.y - start.y, end.x - start.x);

  return {
    x: start.x,
    y: start.y,
    width: lengthPx,
    height: heightPx,
    angleRad,
    variant,
  };
}

export function effectScreenSizePx(effect: ActiveSpellEffect, asset: Jb2aEffectAsset): number {
  const grid = getMapGridSize();
  const aoe = effect.aoe!;
  const placement = effect.placement!;
  const type = aoe.type.toLowerCase();

  if (asset.directed) {
    const worldSpan = placementTravelWorldSpan(placement);
    return worldSpanToScreenPx(
      placement.originX,
      placement.originY,
      worldSpan,
    );
  }

  let worldPx = feetToPixels(aoe.size, grid);
  if (type === 'line' || type === 'cone') {
    return worldSpanToScreenPx(placement.originX, placement.originY, worldPx);
  }
  if (type !== 'line' && type !== 'cone') {
    worldPx *= 2;
  }
  const pt = placementWorldPoint(placement, false);
  return worldSpanToScreenPx(pt.x, pt.z, worldPx);
}

export function resolveCastAsset(effect: ActiveSpellEffect): {
  asset: Jb2aEffectAsset;
  variant: ReturnType<typeof pickJb2aVariant>;
} | null {
  if (!effect.aoe) return null;
  const mapping = resolveSpellJb2aMapping(effect.spellName, effect.aoe.type);
  const asset = mapping.cast ?? mapping.zone;
  if (!asset) return null;
  const enriched = withBeamVariants(asset);
  const variant = asset.directed
    ? pickBeamVariantForWorldSpan(
        enriched,
        placementTravelWorldSpan(effect.placement!),
        getMapGridSize(),
      )
    : pickJb2aVariant(enriched, effectScreenSizePx(effect, enriched));
  return { asset: enriched, variant };
}

export function resolveShotPlacementsForEffect(
  effect: ActiveSpellEffect,
  items: Record<string, Item>,
  liveById: Record<string, LiveTransform | undefined>,
  directed: boolean,
): AoePlacement[] {
  const targets = resolveShotTargetIds(effect.targetTokenIds ?? [], effect.projectileCount);
  const caster = items[effect.casterTokenId];
  if (targets.length > 0) {
    const placements: AoePlacement[] = [];
    for (const id of targets) {
      const token = items[id];
      if (token?.type !== 'token') continue;
      if (caster?.type === 'token' && directed) {
        placements.push(placementFromCasterToTargetLive(caster, token, liveById));
      } else {
        placements.push(placementOnTokenLive(token, liveById));
      }
    }
    if (placements.length > 0) return placements;
  }
  return effect.placement ? [effect.placement] : [];
}
