import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore, type Combatant } from '@/systems/map/store/initiativeStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { persistInitiativeLocal } from '@/systems/scene/sessionPersistence';
import type { TokenItem } from '@/systems/scene/types';
import { readTempHp } from './hpUtils';

export function syncInitiativeToServer(): void {
  const { sessionId } = useSessionStore.getState();
  if (!sessionId) return;
  const { combatants, currentIndex, round, isActive } = useInitiativeStore.getState();
  persistInitiativeLocal(sessionId, { combatants, currentIndex, round, isActive });
  (getSocket() as any).emit('initiative:sync', { sessionId, combatants, currentIndex, round, isActive });
}

/** Push initiative combatant HP/temp HP to its linked map token. */
export function applyCombatantHpToToken(
  combatant: Combatant,
  patch: { hp?: number; tempHp?: number },
): void {
  if (!combatant.tokenId) return;
  const item = useItemStore.getState().items[combatant.tokenId];
  if (!item || item.type !== 'token') return;

  const updates: Partial<TokenItem> = {};
  if (patch.hp !== undefined) {
    updates.hp = Math.max(0, Math.min(patch.hp, item.maxHp));
  }
  if (patch.tempHp !== undefined) {
    updates.tempHp = readTempHp(patch.tempHp);
  }
  if (Object.keys(updates).length === 0) return;

  const nextHp = updates.hp ?? item.hp;
  const nextTemp = updates.tempHp ?? readTempHp(item.tempHp);
  if (item.hp === nextHp && readTempHp(item.tempHp) === nextTemp) return;

  useItemStore.getState().updateItem(combatant.tokenId, updates);
  emitItemUpdate([{ id: combatant.tokenId, patch: updates }]);
}

/** Push token HP changes to any linked initiative combatants. */
export function applyTokenHpToCombatants(
  tokenId: string,
  patch: { hp?: number; maxHp?: number; tempHp?: number },
): void {
  if (patch.hp === undefined && patch.maxHp === undefined && patch.tempHp === undefined) return;

  const store = useInitiativeStore.getState();
  let changed = false;

  for (const c of store.combatants) {
    if (c.tokenId !== tokenId) continue;

    const maxHp = patch.maxHp !== undefined ? Math.max(1, patch.maxHp) : c.maxHp;
    let hp = patch.hp !== undefined ? Math.max(0, patch.hp) : c.hp;
    const tempHp = patch.tempHp !== undefined ? readTempHp(patch.tempHp) : readTempHp(c.tempHp);
    if (hp > maxHp) hp = maxHp;

    if (hp === c.hp && maxHp === c.maxHp && tempHp === readTempHp(c.tempHp)) continue;

    store.updateCombatant(c.id, { hp, maxHp, tempHp });
    changed = true;
  }

  if (changed) syncInitiativeToServer();
}

/** Push token conditions to linked initiative combatants. */
export function applyTokenConditionsToCombatants(tokenId: string, conditions: string[]): void {
  const store = useInitiativeStore.getState();
  let changed = false;

  for (const c of store.combatants) {
    if (c.tokenId !== tokenId) continue;
    const same =
      c.conditions.length === conditions.length &&
      c.conditions.every((x, i) => x === conditions[i]);
    if (same) continue;
    store.updateCombatant(c.id, { conditions: [...conditions] });
    changed = true;
  }

  if (changed) syncInitiativeToServer();
}

/** Push combatant conditions to linked map token. */
export function applyCombatantConditionsToToken(combatant: Combatant): void {
  if (!combatant.tokenId) return;
  const item = useItemStore.getState().items[combatant.tokenId];
  if (!item || item.type !== 'token') return;

  const conditions = combatant.conditions;
  const same =
    item.conditions.length === conditions.length &&
    item.conditions.every((x, i) => x === conditions[i]);
  if (same) return;

  useItemStore.getState().updateItem(combatant.tokenId, { conditions: [...conditions] });
  emitItemUpdate([{ id: combatant.tokenId, patch: { conditions: [...conditions] } }]);
}
