import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { useCombatStore } from './combatStore';

/** Token to use as AoE origin — monster actions panel token, else first selected token. */
export function useCasterToken(): TokenItem | null {
  const tokenActionsToken = useCombatStore((s) => s.tokenActionsToken);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);

  if (tokenActionsToken) return tokenActionsToken;

  for (const id of selectedIds) {
    const item = items[id];
    if (item?.type === 'token') return item;
  }
  return null;
}
