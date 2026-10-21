import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  playerCanRotateToken,
  playerOwnsToken,
  isPlayerCharacterToken,
} from '@/systems/scene/token/clientTokenVisibility';
import type { TokenItem } from '@/systems/scene/types';
import { useFirstPersonStore } from './firstPersonStore';

/** Resolve which token the local client is driving in FP. */
export function resolveFirstPersonToken(): TokenItem | null {
  const { myUserId, myRole } = useSessionStore.getState();
  const { items, selectedIds } = useItemStore.getState();
  const live = useLiveTransformStore.getState().byId;
  const fp = useFirstPersonStore.getState();
  const fpTokenId = fp.tokenId;

  const pick = (id: string | undefined): TokenItem | null => {
    if (!id) return null;
    const base = items[id];
    if (base?.type !== 'token') return null;
    const t = live[id] ? ({ ...base, ...live[id] } as TokenItem) : (base as TokenItem);
    if (myRole === 'GM') return t;
    if (playerOwnsToken(t, myUserId) || (isPlayerCharacterToken(t) && playerCanRotateToken(t, myUserId))) {
      return t;
    }
    return null;
  };

  if (fpTokenId) {
    const locked = pick(fpTokenId);
    if (locked) return locked;
    // FP session lock — keep driving even after selection was cleared on enter.
    const base = items[fpTokenId];
    if (fp.enabled && base?.type === 'token') {
      return live[fpTokenId]
        ? ({ ...base, ...live[fpTokenId] } as TokenItem)
        : (base as TokenItem);
    }
  }

  for (const id of selectedIds) {
    const t = pick(id);
    if (t) return t;
  }
  for (const id of Object.keys(items)) {
    const base = items[id];
    if (base?.type !== 'token') continue;
    const t = live[id] ? ({ ...base, ...live[id] } as TokenItem) : (base as TokenItem);
    if (myRole === 'GM') continue;
    if (playerOwnsToken(t, myUserId) || isPlayerCharacterToken(t)) return t;
  }
  return null;
}

export function resolveFirstPersonTokenOrNull(): TokenItem | null {
  return resolveFirstPersonToken();
}

/** Active map grid helper for FP. */
export function fpGridSize(): number {
  return getActiveMap()?.gridSize ?? 96;
}
