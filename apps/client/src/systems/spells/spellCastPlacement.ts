import type { AoePlacement } from '@/systems/combat/aoeGeometry';
import type { TokenItem } from '@/systems/scene/types';
import { itemCenter } from '@/systems/scene/types';
import type { LiveTransform } from '@/systems/scene/store/liveTransformStore';
import { tokenAimPoint } from '@/systems/scene/token/pickInteractableToken';
import type { SpellEffectCatalogEntry } from './spellEffectsCatalog';

export function placementAtPoint(x: number, y: number, angleRad = 0): AoePlacement {
  return {
    originX: x,
    originY: y,
    angleRad,
    centerX: x,
    centerY: y,
  };
}

export function placementOnToken(token: TokenItem): AoePlacement {
  const { cx, cy } = itemCenter(token);
  return placementAtPoint(cx, cy);
}

function tokenCenterLive(
  token: TokenItem,
  liveById?: Record<string, LiveTransform | undefined>,
): { cx: number; cy: number } {
  const aim = tokenAimPoint(token, liveById?.[token.id]);
  return { cx: aim.x, cy: aim.z };
}

export function placementOnTokenLive(
  token: TokenItem,
  liveById?: Record<string, LiveTransform | undefined>,
): AoePlacement {
  const { cx, cy } = tokenCenterLive(token, liveById);
  return placementAtPoint(cx, cy);
}

export function placementFromCasterToTarget(
  caster: TokenItem,
  target: TokenItem,
): AoePlacement {
  const from = itemCenter(caster);
  const to = itemCenter(target);
  const angleRad = Math.atan2(to.cy - from.cy, to.cx - from.cx);
  return {
    originX: from.cx,
    originY: from.cy,
    angleRad,
    centerX: to.cx,
    centerY: to.cy,
  };
}

/** Uses live map positions (3D / dragged tokens) for beam endpoints. */
export function placementFromCasterToTargetLive(
  caster: TokenItem,
  target: TokenItem,
  liveById?: Record<string, LiveTransform | undefined>,
): AoePlacement {
  const from = tokenCenterLive(caster, liveById);
  const to = tokenCenterLive(target, liveById);
  const angleRad = Math.atan2(to.cy - from.cy, to.cx - from.cx);
  return {
    originX: from.cx,
    originY: from.cy,
    angleRad,
    centerX: to.cx,
    centerY: to.cy,
  };
}

/** Point burst used so ranged/self/melee casts still sync VFX placement. */
export const POINT_BURST_AOE = { size: 5, type: 'radius' } as const;

export function defaultDescription(entry: SpellEffectCatalogEntry): string {
  if (entry.concentration) return 'Concentration, up to 1 minute';
  if (entry.hasZoneLoop) return 'Concentration, up to 10 minutes';
  if (entry.castMode === 'aoe') return 'Instantaneous';
  return 'Instantaneous';
}

export function castModeLabel(mode: SpellEffectCatalogEntry['castMode']): string {
  switch (mode) {
    case 'aoe': return 'AoE';
    case 'ranged': return 'Ranged';
    case 'melee': return 'Melee';
    case 'self': return 'Self';
    default: return mode;
  }
}
