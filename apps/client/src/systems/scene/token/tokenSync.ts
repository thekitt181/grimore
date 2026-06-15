import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { emitItemAdd, emitItemRemove, emitItemUpdate } from '../sceneSync';
import { DEFAULT_MAP_GRID_SIZE } from '../types';
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
  const socket = getSocket();
  if (socket.connected) {
    socket.emit('token:move', { sessionId: s, tokenId, gridCol, gridRow, x, y });
  }
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
    case 'token:place': {
      const { token } = payload as { token: Record<string, unknown> };
      const id = String(token.id ?? '');
      if (!id || store.items[id]) break;
      const map = getActiveMap();
      const gridSize = map?.gridSize ?? DEFAULT_MAP_GRID_SIZE;
      const gridCol = Number(token.gridCol ?? 0);
      const gridRow = Number(token.gridRow ?? 0);
      store.upsertItem({
        id,
        type: 'token',
        name: String(token.name ?? 'Token'),
        x: gridCol * gridSize,
        y: gridRow * gridSize,
        width: gridSize,
        height: gridSize,
        rotation: Number(token.rotation ?? 0),
        imageUrl: String(token.image ?? ''),
        renderType: (token.type as '2d' | '3d') ?? '2d',
        gridCol,
        gridRow,
        hp: token.hp as number | undefined,
        maxHp: token.maxHp as number | undefined,
        conditions: (token.conditions as string[]) ?? [],
        borderColour: String(token.borderColour ?? '#c9a84c'),
        visible: !token.hidden,
        ownerId: String(token.ownerId ?? '') || undefined,
        zIndex: 1,
      } as TokenItem);
      break;
    }
    default:
      break;
  }
}
