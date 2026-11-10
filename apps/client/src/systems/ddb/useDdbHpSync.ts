import { useEffect } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { applyTokenHpToCombatants } from '@/systems/initiative/initiativeTokenSync';
import { patchDdbHp } from './ddbApi';
import type { TokenItem } from '@/systems/scene/types';

let pushTimer: ReturnType<typeof setTimeout> | null = null;
const pending = new Map<number, { hp: number; tempHp: number }>();
/** Skip outbound push while applying HP pulled from DDB (avoids echo loop). */
let suppressHpPushDepth = 0;
/** Token ids the player/GM just edited — DDB pulls must not clobber for a few seconds. */
const lastLocalHpWriteAt = new Map<string, number>();
const LOCAL_HP_GUARD_MS = 12_000;

export function markLocalHpWrite(tokenId: string): void {
  lastLocalHpWriteAt.set(tokenId, Date.now());
}

function scheduleHpPush(ddbCharacterId: number, hp: number, tempHp: number): void {
  pending.set(ddbCharacterId, { hp, tempHp });
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const entries = [...pending.entries()];
    pending.clear();
    pushTimer = null;
    for (const [id, vals] of entries) {
      void patchDdbHp(id, vals.hp, vals.tempHp).catch(() => {
        /* best-effort */
      });
    }
  }, 800);
}

/** Watch token HP edits and push to DDB when syncHpToDdb is enabled. */
export function useDdbHpSync(): void {
  useEffect(() => {
    const unsub = useItemStore.subscribe((state, prev) => {
      for (const id of Object.keys(state.items)) {
        const item = state.items[id];
        const prevItem = prev.items[id];
        if (!item || item.type !== 'token' || !prevItem || prevItem.type !== 'token') continue;

        const token = item as TokenItem;
        const prevToken = prevItem as TokenItem;
        if (!token.ddbCharacterId || !token.syncHpToDdb || suppressHpPushDepth > 0) continue;

        const hpChanged = token.hp !== prevToken.hp;
        const tempChanged = (token.tempHp ?? 0) !== (prevToken.tempHp ?? 0);
        if (!hpChanged && !tempChanged) continue;

        scheduleHpPush(token.ddbCharacterId, token.hp, token.tempHp ?? 0);
      }
    });
    return unsub;
  }, []);
}

export function pullDdbHpToToken(
  tokenId: string,
  character: { hp: number; maxHp: number; tempHp: number; ac?: number; darkvisionFt?: number },
  opts?: { force?: boolean },
): void {
  if (!opts?.force) {
    const wroteAt = lastLocalHpWriteAt.get(tokenId);
    if (wroteAt != null && Date.now() - wroteAt < LOCAL_HP_GUARD_MS) return;
  }

  const existing = useItemStore.getState().items[tokenId];
  const token = existing?.type === 'token' ? (existing as TokenItem) : null;
  if (
    token
    && token.hp === character.hp
    && token.maxHp === character.maxHp
    && (token.tempHp ?? 0) === (character.tempHp ?? 0)
    && (character.ac == null || character.ac <= 0 || token.ac === character.ac)
  ) {
    return;
  }

  const patch: Partial<TokenItem> = {
    hp: character.hp,
    maxHp: character.maxHp,
    tempHp: character.tempHp,
    ...(character.ac != null && character.ac > 0 ? { ac: character.ac } : {}),
    ...(character.darkvisionFt != null ? { visionRadius: character.darkvisionFt / 5 } : {}),
  };
  suppressHpPushDepth += 1;
  try {
    useItemStore.getState().updateItem(tokenId, patch);
    emitItemUpdate([{ id: tokenId, patch }]);
    applyTokenHpToCombatants(tokenId, patch);
  } finally {
    suppressHpPushDepth -= 1;
  }
}
