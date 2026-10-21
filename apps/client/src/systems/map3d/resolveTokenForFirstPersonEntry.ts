import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import type { TokenItem } from '@/systems/scene/types';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';

/** Token to enter FP — selection, FP lock, or (GM) any token on the active map. */
export function resolveTokenForFirstPersonEntry(): TokenItem | null {
  const locked = resolveFirstPersonToken();
  if (locked) return locked;

  if (useSessionStore.getState().myRole !== 'GM') return null;

  const map = getActiveMap();
  if (!map) return null;

  const items = useItemStore.getState().items;
  for (const it of Object.values(items)) {
    if (it?.type === 'token') return it as TokenItem;
  }
  return null;
}
