import { getActiveMap, useItemStore } from './store/itemStore';
import { emitItemRemove, emitItemUpdate } from './sceneSync';
import { removeWallIndices } from '@/systems/map/wallUtils';
import type { MapItem } from './types';

/** Delete selected scene items and/or wall segments on the active map. */
export function deleteCurrentSelection(): boolean {
  const store = useItemStore.getState();
  const itemIds = store.selectedIds;
  const wallIndices = store.selectedWallIndices;
  let changed = false;

  if (itemIds.length > 0) {
    store.removeItems(itemIds);
    emitItemRemove(itemIds);
    changed = true;
  }

  if (wallIndices.length > 0) {
    const map = getActiveMap();
    if (map) {
      const nextWalls = removeWallIndices(map, wallIndices);
      if (nextWalls.length !== (map.walls ?? []).length) {
        const patch: Partial<MapItem> = { walls: nextWalls };
        store.updateItem(map.id, patch);
        emitItemUpdate([{ id: map.id, patch }]);
        store.clearWallSelection();
        changed = true;
      }
    }
  }

  return changed;
}
