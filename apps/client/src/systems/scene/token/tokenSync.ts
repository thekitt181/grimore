import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '../store/itemStore';
import { emitItemAdd, emitItemRemove, emitItemUpdate } from '../sceneSync';
import type { TokenItem } from '../types';

function sid(): string | null {
  return useSessionStore.getState().sessionId;
}

export function emitTokenPlace(token: TokenItem) {
  const s = sid();
  if (!s) return;
  useItemStore.getState().addItem(token);
  emitItemAdd(token);
  (getSocket() as any).emit('token:place', {
    sessionId: s,
    token: {
      id: token.id,
      name: token.name,
      image: token.imageUrl ?? '',
      type: token.renderType ?? '2d',
      gridCol: token.gridCol ?? 0,
      gridRow: token.gridRow ?? 0,
      rotation: token.rotation,
      hp: token.hp,
      maxHp: token.maxHp,
      conditions: token.conditions,
      borderColour: token.borderColour ?? '#c9a84c',
      hidden: !token.visible,
      ownerId: token.ownerId ?? '',
    },
  });
}

export function emitTokenMove(tokenId: string, gridCol: number, gridRow: number, x: number, y: number) {
  const s = sid();
  if (!s) return;
  const patch = { x, y, gridCol, gridRow };
  useItemStore.getState().updateItem(tokenId, patch);
  emitItemUpdate([{ id: tokenId, patch }]);
  (getSocket() as any).emit('token:move', { sessionId: s, tokenId, gridCol, gridRow, x, y });
}

export function emitTokenHp(tokenId: string, hp: number, maxHp: number) {
  const s = sid();
  if (!s) return;
  useItemStore.getState().updateItem(tokenId, { hp, maxHp });
  emitItemUpdate([{ id: tokenId, patch: { hp, maxHp } }]);
  (getSocket() as any).emit('token:hp', { sessionId: s, tokenId, hp, maxHp });
}

export function emitTokenType(tokenId: string, type: '2d' | '3d') {
  const s = sid();
  if (!s) return;
  useItemStore.getState().updateItem(tokenId, { renderType: type });
  emitItemUpdate([{ id: tokenId, patch: { renderType: type } }]);
  (getSocket() as any).emit('token:type', { sessionId: s, tokenId, type });
}

export function emitTokenRotate(tokenId: string, rotation: number) {
  const s = sid();
  if (!s) return;
  useItemStore.getState().updateItem(tokenId, { rotation });
  emitItemUpdate([{ id: tokenId, patch: { rotation } }]);
  (getSocket() as any).emit('token:rotate', { sessionId: s, tokenId, rotation });
}

export function emitTokenHide(tokenId: string, hidden: boolean) {
  const s = sid();
  if (!s) return;
  useItemStore.getState().updateItem(tokenId, { visible: !hidden });
  emitItemUpdate([{ id: tokenId, patch: { visible: !hidden } }]);
  (getSocket() as any).emit('token:hide', { sessionId: s, tokenId, hidden });
}

export function emitTokenDelete(tokenId: string) {
  const s = sid();
  if (!s) return;
  useItemStore.getState().removeItems([tokenId]);
  emitItemRemove([tokenId]);
  (getSocket() as any).emit('token:delete', { sessionId: s, tokenId });
}

export function emitTokenCondition(tokenId: string, conditions: string[]) {
  const s = sid();
  if (!s) return;
  useItemStore.getState().updateItem(tokenId, { conditions });
  emitItemUpdate([{ id: tokenId, patch: { conditions } }]);
  (getSocket() as any).emit('token:condition', { sessionId: s, tokenId, conditions });
}

/** Apply remote token:* payloads onto itemStore (item:update already handled elsewhere). */
export function applyTokenSocketPatch(
  event: string,
  payload: Record<string, unknown>,
): void {
  const store = useItemStore.getState();
  switch (event) {
    case 'token:move': {
      const { tokenId, x, y, gridCol, gridRow } = payload as {
        tokenId: string; x: number; y: number; gridCol: number; gridRow: number;
      };
      store.updateItem(tokenId, { x, y, gridCol, gridRow });
      break;
    }
    case 'token:hp': {
      const { tokenId, hp, maxHp } = payload as { tokenId: string; hp: number; maxHp: number };
      store.updateItem(tokenId, { hp, maxHp });
      break;
    }
    case 'token:type': {
      const { tokenId, type } = payload as { tokenId: string; type: '2d' | '3d' };
      store.updateItem(tokenId, { renderType: type });
      break;
    }
    case 'token:rotate': {
      const { tokenId, rotation } = payload as { tokenId: string; rotation: number };
      store.updateItem(tokenId, { rotation });
      break;
    }
    case 'token:hide': {
      const { tokenId, hidden } = payload as { tokenId: string; hidden: boolean };
      store.updateItem(tokenId, { visible: !hidden });
      break;
    }
    case 'token:delete': {
      const { tokenId } = payload as { tokenId: string };
      store.removeItems([tokenId]);
      break;
    }
    case 'token:condition': {
      const { tokenId, conditions } = payload as { tokenId: string; conditions: string[] };
      store.updateItem(tokenId, { conditions });
      break;
    }
    default:
      break;
  }
}
