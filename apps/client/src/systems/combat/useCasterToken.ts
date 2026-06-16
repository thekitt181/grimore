import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionStore } from '@/store/sessionStore';
import { useCombatStore } from './combatStore';

/** Token to use as spell/AoE origin — actions panel token, selection, then owned token. */
export function useCasterToken(): TokenItem | null {
  const tokenActionsToken = useCombatStore((s) => s.tokenActionsToken);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);
  const myUserId = useSessionStore((s) => s.myUserId);

  if (tokenActionsToken) return tokenActionsToken;

  for (const id of selectedIds) {
    const item = items[id];
    if (item?.type === 'token') return item;
  }

  if (myUserId) {
    for (const item of Object.values(items)) {
      if (item?.type === 'token' && item.ownerId === myUserId) return item;
    }
  }

  return null;
}
