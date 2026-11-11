import type { RollMode } from '@grimoire/dice-engine';
import type { ActionRange } from '@/systems/compendium/statBlockParser';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { itemCenter, type TokenItem } from '@/systems/scene/types';

export interface AttackRangeEval {
  distanceFt: number;
  inRange: boolean;
  /** Melee vs ranged mode used for this evaluation. */
  effectiveKind: 'melee' | 'ranged' | 'unknown';
  autoDisadvantage: boolean;
  effectiveRollMode: RollMode;
  blockReason?: string;
  summary: string;
  warnings: string[];
}

const FEET_PER_CELL = 5;

export function tokenFlyHeightFt(token: Pick<TokenItem, 'flyHeightFt'>): number {
  const n = token.flyHeightFt;
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, n) : 0;
}

export function tokenFlyLabel(name: string, flyHeightFt: number): string {
  if (flyHeightFt <= 0) return name;
  return `${name}  ↑${Math.round(flyHeightFt)} ft`;
}

export interface TokenDistanceBreakdown {
  mapFt: number;
  heightFt: number;
  distanceFt: number;
}

export function tokenDistanceBreakdown(
  a: TokenItem,
  b: TokenItem,
  gridSize = getMapGridSize(),
): TokenDistanceBreakdown {
  const ac = itemCenter(a);
  const tc = itemCenter(b);
  const distPx = Math.hypot(tc.cx - ac.cx, tc.cy - ac.cy);
  const centerFeet = (distPx / gridSize) * FEET_PER_CELL;
  const aRadius = (Math.min(a.width, a.height) / 2 / gridSize) * FEET_PER_CELL;
  const bRadius = (Math.min(b.width, b.height) / 2 / gridSize) * FEET_PER_CELL;
  const mapFt = Math.max(0, centerFeet - aRadius - bRadius);
  const heightFt = Math.abs(tokenFlyHeightFt(a) - tokenFlyHeightFt(b));
  const distanceFt = Math.hypot(mapFt, heightFt);
  return {
    mapFt: Math.round(mapFt),
    heightFt: Math.round(heightFt),
    distanceFt: Math.round(distanceFt),
  };
}

export function getMapGridSize(): number {
  return getActiveMap()?.gridSize ?? 70;
}

/** World-space drag delta → distance in feet (5 ft per grid cell). */
export function worldDeltaToFeet(
  dx: number,
  dy: number,
  gridSize = getMapGridSize(),
): number {
  const distPx = Math.hypot(dx, dy);
  return Math.round((distPx / gridSize) * FEET_PER_CELL);
}

/** Edge-to-edge distance between two tokens in feet (5 ft per grid cell). */
export function tokenDistanceFeet(
  attacker: TokenItem,
  target: TokenItem,
  gridSize = getMapGridSize(),
): number {
  return tokenDistanceBreakdown(attacker, target, gridSize).distanceFt;
}

/** True if any other token is within 5 ft of the attacker (ranged-in-melee rule). */
export function hasAdjacentToken(
  attackerId: string,
  attacker: TokenItem,
  allTokens: TokenItem[],
  gridSize = getMapGridSize(),
): boolean {
  return otherTokensWithin5Ft(attackerId, attacker, allTokens, gridSize);
}

function otherTokensWithin5Ft(
  attackerId: string,
  attacker: TokenItem,
  allTokens: TokenItem[],
  gridSize: number,
): boolean {
  for (const t of allTokens) {
    if (t.id === attackerId) continue;
    if (tokenDistanceFeet(attacker, t, gridSize) <= 5) return true;
  }
  return false;
}

/** Combine player-chosen roll mode with automatic disadvantage (5e: adv + dis cancel). */
export function effectiveRollMode(requested: RollMode, autoDisadvantage: boolean): RollMode {
  if (!autoDisadvantage) return requested;
  if (requested === 'advantage') return 'normal';
  return 'disadvantage';
}

export function formatActionRangeLabel(range: ActionRange): string {
  if (range.kind === 'melee') {
    return `reach ${range.reachFt} ft`;
  }
  if (range.kind === 'ranged') {
    if (range.rangeNormalFt !== undefined && range.rangeLongFt !== undefined) {
      return `range ${range.rangeNormalFt}/${range.rangeLongFt} ft`;
    }
    if (range.rangeNormalFt !== undefined) {
      return `range ${range.rangeNormalFt} ft`;
    }
    return 'ranged';
  }
  if (range.kind === 'both') {
    const reach = `reach ${range.reachFt} ft`;
    const rng =
      range.rangeNormalFt !== undefined && range.rangeLongFt !== undefined
        ? `range ${range.rangeNormalFt}/${range.rangeLongFt} ft`
        : range.rangeNormalFt !== undefined
          ? `range ${range.rangeNormalFt} ft`
          : '';
    return rng ? `${reach} · ${rng}` : reach;
  }
  return '';
}

export function evaluateAttackRange(
  attacker: TokenItem,
  target: TokenItem,
  range: ActionRange,
  allTokens: TokenItem[],
  requestedRollMode: RollMode,
  gridSize = getMapGridSize(),
): AttackRangeEval {
  const distanceFt = tokenDistanceFeet(attacker, target, gridSize);
  const warnings: string[] = [];
  let inRange = true;
  let blockReason: string | undefined;
  let autoDisadvantage = false;

  let effectiveKind: AttackRangeEval['effectiveKind'] =
    range.kind === 'melee' ? 'melee'
      : range.kind === 'ranged' ? 'ranged'
        : range.kind === 'both' ? (distanceFt <= range.reachFt ? 'melee' : 'ranged')
          : 'unknown';

  if (effectiveKind === 'melee') {
    const reach = range.reachFt;
    if (distanceFt > reach) {
      inRange = false;
      blockReason = `Out of reach (${distanceFt} ft away, reach ${reach} ft)`;
    }
  } else if (effectiveKind === 'ranged') {
    const normal = range.rangeNormalFt;
    const long = range.rangeLongFt;

    if (normal !== undefined) {
      const maxRange = long ?? normal;
      if (distanceFt > maxRange) {
        inRange = false;
        blockReason = long !== undefined
          ? `Out of range (${distanceFt} ft away, max ${long} ft)`
          : `Out of range (${distanceFt} ft away, max ${normal} ft)`;
      } else if (long !== undefined && distanceFt > normal) {
        autoDisadvantage = true;
        warnings.push(`Long range (${distanceFt} ft, normal ${normal} ft)`);
      }
    }

    if (otherTokensWithin5Ft(attacker.id, attacker, allTokens, gridSize)) {
      autoDisadvantage = true;
      warnings.push('Disadvantage: creature within 5 ft');
    }
  }

  const effectiveRollModeValue = effectiveRollMode(requestedRollMode, autoDisadvantage);

  let summary = `${distanceFt} ft`;
  if (inRange) {
    if (effectiveKind === 'melee') summary += ` · in reach`;
    else if (effectiveKind === 'ranged') summary += autoDisadvantage ? ' · in range (dis)' : ' · in range';
    else summary += ' · —';
  }

  const evalResult: AttackRangeEval = {
    distanceFt,
    inRange,
    effectiveKind,
    autoDisadvantage,
    effectiveRollMode: effectiveRollModeValue,
    summary,
    warnings,
  };
  if (blockReason !== undefined) evalResult.blockReason = blockReason;
  return evalResult;
}
