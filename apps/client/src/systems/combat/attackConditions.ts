import type { RollMode } from '@grimoire/dice-engine';
import type { TokenItem } from '@/systems/scene/types';

export interface ConditionAttackEffect {
  blockReason?: string;
  advantageReasons: string[];
  disadvantageReasons: string[];
  /** Melee within 5 ft vs helpless target — auto crit on hit (PHB). */
  autoCritOnHit: boolean;
}

function has(token: TokenItem, condition: string): boolean {
  const key = condition.toLowerCase();
  return token.conditions.some((c) => c.toLowerCase() === key);
}

const CANT_ACT = ['Incapacitated', 'Paralyzed', 'Petrified', 'Stunned', 'Unconscious'] as const;

/** Attacker conditions — affects their attack rolls or blocks the attack. */
export function evaluateAttackerConditions(token: TokenItem): ConditionAttackEffect {
  const advantageReasons: string[] = [];
  const disadvantageReasons: string[] = [];

  for (const c of CANT_ACT) {
    if (has(token, c)) {
      return {
        blockReason: `Cannot attack (${c})`,
        advantageReasons: [],
        disadvantageReasons: [],
        autoCritOnHit: false,
      };
    }
  }

  if (has(token, 'Blinded')) disadvantageReasons.push('Blinded (attacker)');
  if (has(token, 'Frightened')) disadvantageReasons.push('Frightened (attacker)');
  if (has(token, 'Poisoned')) disadvantageReasons.push('Poisoned (attacker)');
  if (has(token, 'Restrained')) disadvantageReasons.push('Restrained (attacker)');
  if (has(token, 'Prone')) disadvantageReasons.push('Prone (attacker)');
  if (has(token, 'Exhaustion')) disadvantageReasons.push('Exhaustion (attacker, ≥3)');

  if (has(token, 'Invisible')) advantageReasons.push('Invisible (attacker)');

  return { advantageReasons, disadvantageReasons, autoCritOnHit: false };
}

/** Defender conditions — affects attack rolls against them. */
export function evaluateDefenderConditions(
  token: TokenItem,
  attackKind: 'melee' | 'ranged' | 'unknown',
  distanceFt: number,
): ConditionAttackEffect {
  const advantageReasons: string[] = [];
  const disadvantageReasons: string[] = [];
  let autoCritOnHit = false;

  if (has(token, 'Blinded')) advantageReasons.push('Blinded (target)');
  if (has(token, 'Invisible')) disadvantageReasons.push('Invisible (target)');
  if (has(token, 'Paralyzed')) advantageReasons.push('Paralyzed (target)');
  if (has(token, 'Petrified')) advantageReasons.push('Petrified (target)');
  if (has(token, 'Restrained')) advantageReasons.push('Restrained (target)');
  if (has(token, 'Stunned')) advantageReasons.push('Stunned (target)');
  if (has(token, 'Unconscious')) advantageReasons.push('Unconscious (target)');

  if (has(token, 'Prone')) {
    if (attackKind === 'melee' && distanceFt <= 5) {
      advantageReasons.push('Prone (target, within 5 ft)');
    } else if (attackKind === 'ranged' || distanceFt > 5) {
      disadvantageReasons.push('Prone (target, ranged / >5 ft)');
    }
  }

  const helpless = has(token, 'Paralyzed') || has(token, 'Unconscious');
  if (helpless && attackKind === 'melee' && distanceFt <= 5) {
    autoCritOnHit = true;
  }

  return { advantageReasons, disadvantageReasons, autoCritOnHit };
}

/** Merge player roll mode with any advantage/disadvantage sources (5e: adv + dis → normal). */
export function combineAttackRollMode(
  requested: RollMode,
  hasAdvantage: boolean,
  hasDisadvantage: boolean,
): RollMode {
  const adv = requested === 'advantage' || hasAdvantage;
  const dis = requested === 'disadvantage' || hasDisadvantage;
  if (adv && dis) return 'normal';
  if (adv) return 'advantage';
  if (dis) return 'disadvantage';
  return 'normal';
}

export function mergeConditionEffects(
  attacker: TokenItem,
  target: TokenItem,
  attackKind: 'melee' | 'ranged' | 'unknown',
  distanceFt: number,
): ConditionAttackEffect {
  const fromAttacker = evaluateAttackerConditions(attacker);
  if (fromAttacker.blockReason) return fromAttacker;

  const fromDefender = evaluateDefenderConditions(target, attackKind, distanceFt);

  return {
    advantageReasons: [...fromAttacker.advantageReasons, ...fromDefender.advantageReasons],
    disadvantageReasons: [...fromAttacker.disadvantageReasons, ...fromDefender.disadvantageReasons],
    autoCritOnHit: fromDefender.autoCritOnHit,
  };
}
