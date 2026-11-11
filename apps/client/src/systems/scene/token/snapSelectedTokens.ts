import { getActiveMap, useItemStore } from '../store/itemStore';
import { mapUnderTokenFeet } from '../hitTest';
import { snapTokenPosition } from './tokenGrid';
import { emitTokenMove } from './tokenSync';
import { clearWalkPose } from './walkPoseBus';
import type { TokenItem } from '../types';

/** Snap every selected token onto the nearest grid cells. */
export function snapSelectedTokensToGrid(): void {
  const { selectedIds, items } = useItemStore.getState();
  const active = getActiveMap();
  for (const id of selectedIds) {
    const it = items[id];
    if (it?.type !== 'token') continue;
    const token = it as TokenItem;
    const host =
      mapUnderTokenFeet(token.x + token.width / 2, token.y + token.height / 2) ?? active;
    const snapped = snapTokenPosition(token, token.x, token.y, host);
    if (Math.hypot(snapped.x - token.x, snapped.y - token.y) < 0.5) continue;
    clearWalkPose(id);
    emitTokenMove(id, snapped.gridCol, snapped.gridRow, snapped.x, snapped.y);
  }
}
