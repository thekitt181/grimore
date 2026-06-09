import type { RollMode } from '@grimoire/dice-engine';
import type { ActionRange } from '@/systems/compendium/statBlockParser';
import type { TokenItem } from '@/systems/scene/types';
import {
  combineAttackRollMode,
  mergeConditionEffects,
} from './attackConditions';
import {
  getMapGridSize,
  tokenDistanceFeet,
  type AttackRangeEval,
} from './attackRange';

export interface AttackEval extends AttackRangeEval {
  effectiveRollMode: RollMode;
  autoCritOnHit: boolean;
  conditionNotes: string[];
}

/** Full attack evaluation: range, conditions, and final roll mode. */
export function evaluateAttack(
  attacker: TokenItem,
  target: TokenItem,
  range: ActionRange,
  allTokens: TokenItem[],
  requestedRollMode: RollMode,
  gridSize = getMapGridSize(),
): AttackEval {
  const distanceFt = tokenDistanceFeet(attacker, target, gridSize);
  const warnings: string[] = [];
  let inRange = true;
  let blockReason: string | undefined;
  let rangeDisadvantage = false;

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
        rangeDisadvantage = true;
        warnings.push(`Long range (${distanceFt} ft, normal ${normal} ft)`);
      }
    }

    for (const t of allTokens) {
      if (t.id === attacker.id) continue;
      if (tokenDistanceFeet(attacker, t, gridSize) <= 5) {
        rangeDisadvantage = true;
        warnings.push('Disadvantage: creature within 5 ft');
        break;
      }
    }
  }

  const conditions = mergeConditionEffects(attacker, target, effectiveKind, distanceFt);
  if (conditions.blockReason) {
    inRange = false;
    blockReason = conditions.blockReason;
  }

  const conditionNotes: string[] = [];
  if (requestedRollMode === 'advantage') conditionNotes.push('Manual advantage');
  if (requestedRollMode === 'disadvantage') conditionNotes.push('Manual disadvantage');
  conditionNotes.push(
    ...conditions.advantageReasons.map((r) => `Adv: ${r}`),
    ...conditions.disadvantageReasons.map((r) => `Dis: ${r}`),
  );
  if (conditions.autoCritOnHit) {
    conditionNotes.push('Auto-crit on hit (melee ≤5 ft)');
  }

  const hasAdvantage = conditions.advantageReasons.length > 0;
  const hasDisadvantage = rangeDisadvantage || conditions.disadvantageReasons.length > 0;
  const effectiveRollMode = combineAttackRollMode(requestedRollMode, hasAdvantage, hasDisadvantage);

  let summary = `${distanceFt} ft`;
  if (inRange) {
    const rollTag =
      effectiveRollMode === 'advantage' ? ' · adv'
        : effectiveRollMode === 'disadvantage' ? ' · dis'
          : '';
    if (effectiveKind === 'melee') summary += ` · in reach${rollTag}`;
    else if (effectiveKind === 'ranged') summary += ` · in range${rollTag}`;
    else summary += rollTag || ' · —';
  }

  const evalResult: AttackEval = {
    distanceFt,
    inRange,
    effectiveKind,
    autoDisadvantage: hasDisadvantage,
    effectiveRollMode,
    summary,
    warnings: [...warnings, ...conditionNotes],
    autoCritOnHit: conditions.autoCritOnHit,
    conditionNotes,
  };
  if (blockReason !== undefined) evalResult.blockReason = blockReason;
  return evalResult;
}

export { formatActionRangeLabel, getMapGridSize, tokenDistanceFeet } from './attackRange';
