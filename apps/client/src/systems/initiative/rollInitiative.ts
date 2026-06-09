import { v4 as uuidv4 } from 'uuid';
import { rollDice } from '@grimoire/dice-engine';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { syncInitiativeToServer } from './initiativeTokenSync';
import { readTempHp } from './hpUtils';

function dexModForToken(token: TokenItem): number {
  return token.initiativeMod ?? 0;
}

function rollInitiativeForToken(token: TokenItem): number {
  const mod = dexModForToken(token);
  const notation = mod === 0 ? '1d20' : `1d20${mod >= 0 ? '+' : ''}${mod}`;
  return rollDice(notation).total;
}

/** GM: roll d20+DEX for every token on the map and populate the tracker. */
export function rollInitiativeFromTokens(): void {
  const tokens = Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token',
  );
  if (tokens.length === 0) return;

  const store = useInitiativeStore.getState();
  const existingByToken = new Map(
    store.combatants.filter((c) => c.tokenId).map((c) => [c.tokenId!, c]),
  );

  for (const token of tokens) {
    const initiative = rollInitiativeForToken(token);
    const linked = existingByToken.get(token.id);
    if (linked) {
      store.setInitiative(linked.id, initiative);
      store.updateCombatant(linked.id, {
        hp: token.hp,
        maxHp: token.maxHp,
        tempHp: readTempHp(token.tempHp),
        name: token.name,
        conditions: [...token.conditions],
      });
    } else {
      store.addCombatant({
        id: uuidv4(),
        name: token.name,
        initiative,
        hp: token.hp,
        maxHp: token.maxHp,
        tempHp: readTempHp(token.tempHp),
        conditions: [...token.conditions],
        tokenId: token.id,
        isPlayer: false,
      });
    }
  }

  if (!useInitiativeStore.getState().isActive) {
    useInitiativeStore.getState().startCombat();
  }
  syncInitiativeToServer();
}
