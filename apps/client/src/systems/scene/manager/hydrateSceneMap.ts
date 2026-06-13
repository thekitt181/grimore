import { v4 as uuidv4 } from 'uuid';
import type { GameMapRecord, SceneRecord } from '@grimoire/shared';
import { useItemStore } from '../store/itemStore';
import { defaultMapGrid } from '../types';
import type { MapItem } from '../types';
import { emitItemAdd, emitItemsSync } from '../sceneSync';

function mapRecordToItem(map: GameMapRecord, existing?: MapItem): MapItem {
  const w = map.width > 0 ? map.width : 2560;
  const h = map.height > 0 ? map.height : 1920;
  const grid = defaultMapGrid(w, h);
  return {
    id: existing?.id ?? uuidv4(),
    type: 'map',
    x: existing?.x ?? 0,
    y: existing?.y ?? 0,
    rotation: 0,
    width: w,
    height: h,
    zIndex: existing?.zIndex ?? 0,
    locked: existing?.locked ?? false,
    visible: true,
    backgroundUrl: map.imageUrl,
    gridSize: map.gridSize || grid.gridSize,
    gridType: map.gridType === 'HEX' ? 'hex' : 'square',
    gridColor: existing?.gridColor ?? 0xffffff,
    gridOpacity: existing?.gridOpacity ?? 0.35,
    gridOffsetX: grid.gridOffsetX,
    gridOffsetY: grid.gridOffsetY,
    showGrid: existing?.showGrid ?? true,
    walls: Array.isArray(map.walls) ? (map.walls as MapItem['walls']) : [],
  };
}

/** Load scene-linked GameMap onto the live canvas (GM). */
export function hydrateSceneMap(scene: SceneRecord, pushSync = true): void {
  if (!scene.map) return;
  const store = useItemStore.getState();
  const maps = Object.values(store.items).filter((i): i is MapItem => i.type === 'map');
  const existing = maps.find((m) => m.backgroundUrl === scene.map!.imageUrl) ?? maps[0];
  const next = mapRecordToItem(scene.map, existing);
  if (existing) {
    store.updateItem(existing.id, next);
  } else {
    store.addItem(next);
    emitItemAdd(next);
  }
  store.setActiveMap(next.id);
  if (pushSync) emitItemsSync(Object.values(useItemStore.getState().items));
}
