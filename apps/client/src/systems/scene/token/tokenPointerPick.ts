import { pickHandle } from '@/systems/scene/interaction/useTransformControls';
import { pickSceneItem } from '@/systems/scene/sceneRefs';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { pickTokenAtScreen } from '@/systems/map3d/pickTokenScreen';
import { playerSelectableTokens } from './clientTokenVisibility';
import type { TokenItem } from '../types';

function selectableTokensForPick(): TokenItem[] {
  const gm = useSessionStore.getState().myRole === 'GM';
  const items = useItemStore.getState().items;
  if (gm) {
    return Object.values(items).filter(
      (i): i is TokenItem => i.type === 'token' && i.visible !== false,
    );
  }
  return playerSelectableTokens(items, {
    myUserId: useSessionStore.getState().myUserId,
    selectedIds: useItemStore.getState().selectedIds,
    revealedCells: useMapStore.getState().revealedCells,
    activeMap: getActiveMap(),
  });
}

/** Whether the pointer is over a token (raycast or screen bounds fallback). */
export function pointerHitsToken(clientX: number, clientY: number): boolean {
  if (pickHandle(clientX, clientY)) return true;

  const pickId = pickSceneItem(clientX, clientY);
  if (pickId) {
    const item = useItemStore.getState().items[pickId];
    if (item?.type === 'token') return true;
  }

  const tokens = selectableTokensForPick();
  return pickTokenAtScreen(clientX, clientY, tokens) != null;
}
