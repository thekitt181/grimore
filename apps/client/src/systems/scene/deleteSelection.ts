import { getActiveMap, useItemStore } from './store/itemStore';
import { emitItemRemove, emitItemUpdate } from './sceneSync';
import { emitTokenDelete } from './token/tokenSync';
import { removeWallIndices } from '@/systems/map/wallUtils';
import type { MapItem } from './types';

/** Delete selected scene items and/or wall segments on the active map. */
export function deleteCurrentSelection(): boolean {
  const store = useItemStore.getState();
  const itemIds = store.selectedIds;
  const wallIndices = store.selectedWallIndices;
  let changed = false;

  if (itemIds.length > 0) {
    const tokenIds = itemIds.filter((id) => store.items[id]?.type === 'token');
    const otherIds = itemIds.filter((id) => !tokenIds.includes(id));
    const mapIds = new Set(
      otherIds.filter((id) => store.items[id]?.type === 'map'),
    );
    if (mapIds.size > 0) {
      for (const it of Object.values(store.items)) {
        if (it.type !== 'image' || !it.dungeonPropForMapId) continue;
        if (!mapIds.has(it.dungeonPropForMapId)) continue;
        if (!otherIds.includes(it.id)) otherIds.push(it.id);
      }
    }

    for (const tokenId of tokenIds) {
      emitTokenDelete(tokenId);
    }
    if (otherIds.length > 0) {
      store.removeItems(otherIds);
      emitItemRemove(otherIds);
    }
    store.select([], 'set');
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
