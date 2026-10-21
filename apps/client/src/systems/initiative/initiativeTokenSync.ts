import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore, type Combatant } from '@/systems/map/store/initiativeStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { persistInitiativeLocal } from '@/systems/scene/sessionPersistence';
import type { TokenItem } from '@/systems/scene/types';
import type { InitiativeSyncPayload } from '@grimoire/shared';
import { readTempHp } from './hpUtils';

/** Local outbound revision — bumped on every emit. */
let localRevision = 0;
/** Highest revision applied from the server (or our own emit). */
let appliedRevision = 0;

export function getInitiativeAppliedRevision(): number {
  return appliedRevision;
}

/**
 * Apply a remote (or hydrated) initiative payload.
 * Drops stale revisions so late packets cannot springboard the turn highlighter.
 */
export function applyInitiativeSyncPayload(payload: InitiativeSyncPayload): boolean {
  const rev = payload.revision ?? 0;
  if (rev > 0 && rev < appliedRevision) return false;
  if (rev > 0) {
    appliedRevision = rev;
    if (rev > localRevision) localRevision = rev;
  }

  const { sessionId } = useSessionStore.getState();
  useInitiativeStore.getState().syncFromServer(payload);
  if (sessionId) {
    persistInitiativeLocal(sessionId, {
      combatants: payload.combatants,
      currentIndex: payload.currentIndex,
      round: payload.round,
      isActive: payload.isActive,
    });
  }
  return true;
}

export function syncInitiativeToServer(): void {
  const { sessionId } = useSessionStore.getState();
  if (!sessionId) return;
  const { combatants, currentIndex, round, isActive } = useInitiativeStore.getState();
  localRevision += 1;
  appliedRevision = Math.max(appliedRevision, localRevision);
  persistInitiativeLocal(sessionId, { combatants, currentIndex, round, isActive });
  const payload: InitiativeSyncPayload = {
    sessionId,
    combatants,
    currentIndex,
    round,
    isActive,
    revision: localRevision,
  };
  getSocket().emit('initiative:sync', payload);
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
