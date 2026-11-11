import type { QueryClient } from '@tanstack/react-query';
import type { RestKind } from '@grimoire/shared';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { restDdbCharacter } from './ddbApi';
import { pullDdbHpToToken } from './useDdbHpSync';
import { applyTokenHpToCombatants } from '@/systems/initiative/initiativeTokenSync';

export function partyPcTokens(): TokenItem[] {
  return Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId),
  );
}

export async function restParty(kind: RestKind, qc?: QueryClient): Promise<{
  ok: number;
  failed: number;
  pushed: number;
}> {
  const tokens = partyPcTokens();
  let ok = 0;
  let failed = 0;
  let pushed = 0;
  for (const token of tokens) {
    const id = token.ddbCharacterId;
    if (!id) continue;
    try {
      const result = await restDdbCharacter(id, kind);
      ok += 1;
      if (result.pushedToDdb) pushed += 1;
      qc?.setQueryData(['ddb', 'character', id], result.character);
      pullDdbHpToToken(token.id, result.character, { force: true });
      if (kind === 'long') {
        const hp = result.character.maxHp;
        useItemStore.getState().updateItem(token.id, { hp, tempHp: 0 });
        emitItemUpdate([{ id: token.id, patch: { hp, tempHp: 0 } }]);
        applyTokenHpToCombatants(token.id, { hp, tempHp: 0 });
      }
    } catch {
      failed += 1;
    }
  }
  return { ok, failed, pushed };
}
