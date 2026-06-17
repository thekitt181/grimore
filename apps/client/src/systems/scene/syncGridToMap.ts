import { useItemStore } from './store/itemStore';
import { emitItemUpdate } from './sceneSync';
import { gridSizeForMap } from './types';
import type { Item, MapItem } from './types';

export type GridSyncResult =
  | { ok: true; gridSize: number; gridOffsetX: number; gridOffsetY: number; cols: number; rows: number }
  | { ok: false; reason: 'not-found' };

/**
 * Uniform square grid that fits the map: a whole number of equal 5ft cells
 * across the width, aligned to the top-left corner. Cell size scales with the
 * map so it looks consistent regardless of the image's resolution.
 */
export function fitGridToMap(width: number, height: number): { gridSize: number; cols: number; rows: number } {
  const base = gridSizeForMap(width, height);
  const cols = Math.max(1, Math.round(width / base));
  const gridSize = Math.max(4, Math.round(width / cols));
  const rows = Math.max(1, Math.round(height / gridSize));
  return { gridSize, cols, rows };
}

/** Lay a clean 5ft square grid over the map and rescale tokens to keep their cell footprint. */
export function syncGridToMap(map: MapItem): GridSyncResult {
  const { gridSize, cols, rows } = fitGridToMap(map.width, map.height);

  const patch: Partial<MapItem> = { gridSize, gridOffsetX: 0, gridOffsetY: 0 };
  const store = useItemStore.getState();
  store.updateItem(map.id, patch);

  // Resize tokens so each keeps occupying sizeCells × 5ft cells on the new grid
  // (a medium token stays exactly one square), keeping them centered in place.
  const tokenUpdates: Array<{ id: string; patch: Partial<Item> }> = [];
  if (map.gridSize > 0 && Math.abs(gridSize - map.gridSize) > 0.5) {
    for (const it of Object.values(store.items)) {
      if (it.type !== 'token') continue;
      const cells = it.sizeCells || it.width / map.gridSize || 1;
      const newSize = cells * gridSize;
      const cx = it.x + it.width / 2;
      const cy = it.y + it.height / 2;
      tokenUpdates.push({
        id: it.id,
        patch: { width: newSize, height: newSize, x: cx - newSize / 2, y: cy - newSize / 2 },
      });
    }
  }
  if (tokenUpdates.length > 0) store.updateItems(tokenUpdates);

  emitItemUpdate([{ id: map.id, patch }, ...tokenUpdates]);

  return { ok: true, gridSize, gridOffsetX: 0, gridOffsetY: 0, cols, rows };
}

/** Convenience: sync the active map by id. */
export function syncGridToMapById(mapId: string): GridSyncResult {
  const map = useItemStore.getState().items[mapId];
  if (!map || map.type !== 'map') return { ok: false, reason: 'not-found' };
  return syncGridToMap(map);
}
