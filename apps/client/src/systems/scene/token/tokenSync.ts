import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { emitItemAdd, emitItemRemove, emitItemUpdate } from '../sceneSync';
import { clearWalkPose, getWalkPose, setWalkPose } from '@/systems/scene/token/walkPoseBus';
import { applyRemoteWalkPose, clearWalkVisualCommit } from '@/systems/scene/token/remotePoseApply';
import { noteLocalTokenMoveCommit } from '@/systems/scene/token/tokenMoveCommitGuard';
import { ingestWalkLive } from '@/systems/scene/token/walkLiveIngress';
import { DEFAULT_MAP_GRID_SIZE } from '../types';
import type { TokenItem } from '../types';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { firstPersonPose } from '@/systems/map3d/firstPersonPose';
import { firstPersonLook } from '@/systems/map3d/firstPersonLook';

function sid(): string | null {
  return useSessionStore.getState().sessionId;
}

/** Debounced item-store commit — never sync updateItem on the socket hot path. */
const poseCommitTimers = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleRemotePoseCommit(
  tokenId: string,
  patch: { x: number; y: number; gridCol: number; gridRow: number },
): void {
  const prev = poseCommitTimers.get(tokenId);
  if (prev) clearTimeout(prev);
  poseCommitTimers.set(
    tokenId,
    setTimeout(() => {
      poseCommitTimers.delete(tokenId);
      // Still receiving live walk — mesh owns feet; skip Zustand (freezes remotes).
      const walk = getWalkPose(tokenId);
      if (walk && performance.now() - walk.at < 800) {
        return;
      }
      useItemStore.getState().updateItem(tokenId, patch);
      clearWalkPose(tokenId);
    }, 500),
  );
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

export function emitTokenMove(
  tokenId: string,
  gridCol: number,
  gridRow: number,
  x: number,
  y: number,
  opts?: { persist?: boolean },
) {
  const s = sid();
  if (!s) return;
  const patch = { x, y, gridCol, gridRow };
  if (opts?.persist === false) {
    // Soft mid-walk — do not touch remotes (FP uses token:rotate+xy).
    return;
  }
  // Local commit only; remotes get token:move (debounced updateItem there).
  useItemStore.getState().updateItem(tokenId, patch);
  noteLocalTokenMoveCommit(tokenId);
  getSocket().emit('token:move', { sessionId: s, tokenId, gridCol, gridRow, x, y });
}

/**
 * Mid-walk / drag live pose — same class of event as token:rotate (relay only).
 * Remotes apply via applyTokenSocketPatch (useTokenSocket).
 */
export function emitTokenLive(
  tokenId: string,
  x: number,
  y: number,
  rotation: number,
  gridCol?: number,
  gridRow?: number,
) {
  const s = sid();
  if (!s) return;
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit('token:live', {
    sessionId: s,
    tokenId,
    x,
    y,
    rotation,
    ...(gridCol != null ? { gridCol } : {}),
    ...(gridRow != null ? { gridRow } : {}),
  });
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
  const socket = getSocket();
  if (!socket.connected) return;

  // Local UI only — never emitItemUpdate (that froze remotes when combined with walk).
  useItemStore.getState().updateItem(tokenId, { rotation });

  // Always send x/y so remotes use mesh apply (never Zustand updateItem on receive).
  let x: number;
  let y: number;
  if (firstPersonPose.active && firstPersonPose.tokenId === tokenId) {
    x = firstPersonPose.x;
    y = firstPersonPose.y;
  } else {
    const item = useItemStore.getState().items[tokenId];
    if (!item || item.type !== 'token') {
      socket.emit('token:rotate', { sessionId: s, tokenId, rotation });
      return;
    }
    x = item.x;
    y = item.y;
  }

  socket.emit('token:rotate', {
    sessionId: s,
    tokenId,
    rotation: firstPersonPose.active && firstPersonPose.tokenId === tokenId
      ? firstPersonLook.yaw
      : rotation,
    x,
    y,
  });
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
      const { tokenId, x, y, gridCol, gridRow, sessionId } = payload as {
        tokenId: string; x: number; y: number; gridCol: number; gridRow: number; sessionId?: string;
      };
      const fp = useFirstPersonStore.getState();
      if (fp.enabled && fp.tokenId === tokenId) break;
      {
        const sidResolved = sessionId ?? sid();
        ingestWalkLive({
          ...(sidResolved ? { sessionId: sidResolved } : {}),
          tokenId,
          x,
          y,
        });
      }
      scheduleRemotePoseCommit(tokenId, { x, y, gridCol, gridRow });
      break;
    }
    case 'map:tokenMove': {
      const { tokenId, x, y, sessionId } = payload as {
        tokenId: string; x: number; y: number; sessionId?: string;
      };
      {
        const sidResolved = sessionId ?? sid();
        ingestWalkLive({
          ...(sidResolved ? { sessionId: sidResolved } : {}),
          tokenId,
          x,
          y,
        });
      }
      break;
    }
    case 'token:live': {
      const { tokenId, x, y, rotation, sessionId } = payload as {
        tokenId: string;
        x: number;
        y: number;
        rotation: number;
        sessionId?: string;
      };
      {
        const sidResolved = sessionId ?? sid();
        ingestWalkLive({
          ...(sidResolved ? { sessionId: sidResolved } : {}),
          tokenId,
          x,
          y,
          rotation,
        });
      }
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
      const { tokenId, rotation, x, y, sessionId } = payload as {
        tokenId: string;
        rotation: number;
        x?: number;
        y?: number;
        sessionId?: string;
      };
      const fp = useFirstPersonStore.getState();
      if (fp.enabled && fp.tokenId === tokenId) break;
      if (typeof x === 'number' && typeof y === 'number') {
        const sidResolved = sessionId ?? sid();
        ingestWalkLive({
          ...(sidResolved ? { sessionId: sidResolved } : {}),
          tokenId,
          x,
          y,
          rotation,
        });
        break;
      }
      store.updateItem(tokenId, { rotation });
      useLiveTransformStore.getState().setLive(tokenId, { rotation }, { bumpTick: false });
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
      const ox = (map?.x ?? 0) + (map?.gridOffsetX ?? 0);
      const oy = (map?.y ?? 0) + (map?.gridOffsetY ?? 0);
      store.upsertItem({
        id,
        type: 'token',
        name: String(token.name ?? 'Token'),
        x: ox + gridCol * gridSize,
        y: oy + gridRow * gridSize,
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
