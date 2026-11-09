import { queryClient } from '@/lib/queryClient';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import type { GrimoireCharacter } from '@grimoire/shared';

export function clampPartyLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

/** Average level of D&D Beyond PCs currently on the table. */
export function partyLevelFromTokens(): number | null {
  const tokens = Object.values(useItemStore.getState().items).filter(
    (item): item is TokenItem => item.type === 'token' && Boolean(item.ddbCharacterId),
  );
  const levels = tokens.flatMap((token) => {
    const character = queryClient.getQueryData<GrimoireCharacter>(['ddb', 'character', token.ddbCharacterId]);
    return character && character.level > 0 ? [character.level] : [];
  });
  if (levels.length === 0) return null;
  const average = levels.reduce((sum, level) => sum + level, 0) / levels.length;
  return clampPartyLevel(Math.round(average));
}

export function partySizeFromTokens(): number {
  const n = Object.values(useItemStore.getState().items).filter(
    (item): item is TokenItem => item.type === 'token' && Boolean(item.ddbCharacterId),
  ).length;
  return Math.min(8, Math.max(1, n || 4));
}
