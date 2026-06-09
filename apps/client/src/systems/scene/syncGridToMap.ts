import { useItemStore } from './store/itemStore';
import { emitItemUpdate } from './sceneSync';
import { detectGridFromImage } from './gridAutoDetect';
import type { MapItem } from './types';

export type GridSyncResult =
  | { ok: true; gridSize: number; gridOffsetX: number; gridOffsetY: number; confidence: number }
  | { ok: false; reason: 'no-image' | 'detect-failed' | 'not-found' };

/** Detect printed grid on a map image and apply gridSize + offset to the item. */
export async function syncGridToMap(map: MapItem): Promise<GridSyncResult> {
  if (!map.backgroundUrl) return { ok: false, reason: 'no-image' };

  const detected = await detectGridFromImage(map.backgroundUrl, map.width, map.height);
  if (!detected) return { ok: false, reason: 'detect-failed' };

  const patch: Partial<MapItem> = {
    gridSize: detected.gridSize,
    gridOffsetX: detected.gridOffsetX,
    gridOffsetY: detected.gridOffsetY,
  };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);

  return {
    ok: true,
    gridSize: detected.gridSize,
    gridOffsetX: detected.gridOffsetX,
    gridOffsetY: detected.gridOffsetY,
    confidence: detected.confidence,
  };
}

/** Convenience: sync the active map by id. */
export async function syncGridToMapById(mapId: string): Promise<GridSyncResult> {
  const map = useItemStore.getState().items[mapId];
  if (!map || map.type !== 'map') return { ok: false, reason: 'not-found' };
  return syncGridToMap(map);
}
