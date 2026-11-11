import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { useInitiativeStore, type Combatant } from '@/systems/map/store/initiativeStore';
import { applyTokenConditionsToCombatants, applyCombatantConditionsToToken } from './initiativeTokenSync';

export function remainingRounds(rounds: Record<string, number> | undefined, name: string): number | undefined {
  const n = rounds?.[name];
  return typeof n === 'number' && n > 0 ? n : undefined;
}

export function tickConditionRounds(
  conditions: string[],
  rounds: Record<string, number> | undefined,
): { conditions: string[]; conditionRounds: Record<string, number>; changed: boolean } {
  const nextRounds: Record<string, number> = {};
  const nextConditions: string[] = [];
  let changed = false;
  for (const name of conditions) {
    const left = rounds?.[name];
    if (left == null) {
      nextConditions.push(name);
      continue;
    }
    const remain = left - 1;
    changed = true;
    if (remain > 0) {
      nextConditions.push(name);
      nextRounds[name] = remain;
    }
  }
  return { conditions: nextConditions, conditionRounds: nextRounds, changed };
}

/** End of this combatant's turn: duration conditions tick down. */
export function tickCombatantConditionTurn(combatant: Combatant): void {
  const { conditions, conditionRounds, changed } = tickConditionRounds(
    combatant.conditions,
    combatant.conditionRounds,
  );
  if (!changed) return;
  useInitiativeStore.getState().updateCombatant(combatant.id, { conditions, conditionRounds });
  applyCombatantConditionsToToken({ ...combatant, conditions, conditionRounds });
}

export function applyConditionToToken(
  token: TokenItem,
  name: string,
  rounds: number | null,
): void {
  const has = token.conditions.includes(name);
  let conditions: string[];
  const conditionRounds = { ...(token.conditionRounds ?? {}) };
  if (has) {
    conditions = token.conditions.filter((c) => c !== name);
    delete conditionRounds[name];
  } else {
    conditions = [...token.conditions, name];
    if (rounds != null && rounds > 0) conditionRounds[name] = Math.floor(rounds);
    else delete conditionRounds[name];
  }
  useItemStore.getState().updateItem(token.id, { conditions, conditionRounds });
  emitItemUpdate([{ id: token.id, patch: { conditions, conditionRounds } }]);
  applyTokenConditionsToCombatants(token.id, conditions, conditionRounds);
}

export function applyConditionToCombatant(
  combatant: Combatant,
  name: string,
  rounds: number | null,
): void {
  const has = combatant.conditions.includes(name);
  let conditions: string[];
  const conditionRounds = { ...(combatant.conditionRounds ?? {}) };
  if (has) {
    conditions = combatant.conditions.filter((c) => c !== name);
    delete conditionRounds[name];
  } else {
    conditions = [...combatant.conditions, name];
    if (rounds != null && rounds > 0) conditionRounds[name] = Math.floor(rounds);
    else delete conditionRounds[name];
  }
  useInitiativeStore.getState().updateCombatant(combatant.id, { conditions, conditionRounds });
  applyCombatantConditionsToToken({ ...combatant, conditions, conditionRounds });
}
