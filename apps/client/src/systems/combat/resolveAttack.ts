import { normalizeNotation, rollDice, type RollMode, type RollResult } from '@grimoire/dice-engine';
import type { ActionDamage } from '@/systems/compendium/statBlockParser';

export interface AttackResolution {
  notation: string;
  attackTotal: number;
  d20Used: number;
  hit: boolean;
  isCrit: boolean;
  isCritFail: boolean;
  rollMode: RollMode;
}

/** Natural 20 = crit hit; natural 1 = auto miss; otherwise total vs AC. */
export function resolveAttackVsAc(
  d20Used: number,
  attackTotal: number,
  targetAc: number,
): Pick<AttackResolution, 'hit' | 'isCrit' | 'isCritFail'> {
  const isCrit = d20Used === 20;
  const isCritFail = d20Used === 1;
  const hit = isCrit || (!isCritFail && attackTotal >= targetAc);
  return { hit, isCrit, isCritFail };
}

export type AttackRoll = RollResult & { d20Used: number };

export function rollAttack(toHit: number, mode: RollMode = 'normal'): AttackRoll {
  const notation = `1d20${toHit >= 0 ? '+' : ''}${toHit}`;
  const result = rollDice(notation, mode);
  const d20Used = result.usedResults[0] ?? result.results[0] ?? 0;
  return { ...result, d20Used };
}

/** Double dice groups for crit damage (2d6+3 → 4d6+3). */
export function critDamageNotation(notation: string): string {
  const cleaned = normalizeNotation(notation);
  return cleaned.replace(/(\d*)d(\d+)/gi, (_m, count: string, sides: string) => {
    const n = (count ? parseInt(count, 10) : 1) * 2;
    return `${n}d${sides}`;
  });
}

export function rollActionDamage(damage: ActionDamage, isCrit: boolean): RollResult {
  const base = damage.dice.replace(/\s+/g, '');
  const notation = isCrit ? critDamageNotation(base) : base;
  return rollDice(notation);
}
