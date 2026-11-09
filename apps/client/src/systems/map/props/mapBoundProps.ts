import type { ImageItem, Item, MapItem } from '@/systems/scene/types';
import { mapLocalToWorld, worldToMapLocal } from '@/systems/map/wallUtils';

export function isMapBoundProp(item: Item): item is ImageItem {
  if (item.type !== 'image' || !item.dungeonPropForMapId) return false;
  return item.propMapLocalX != null && item.propMapLocalY != null;
}

/** Local top-left → world top-left, rotating about the item center with the map. */
function worldTopLeftFromLocal(
  lx: number,
  ly: number,
  width: number,
  height: number,
  map: MapItem,
): { x: number; y: number } {
  const mid = mapLocalToWorld(lx + width / 2, ly + height / 2, map);
  return { x: mid.x - width / 2, y: mid.y - height / 2 };
}

/** Auto-spawned props: store map-local pose and spawn locked. */
export function bindMapBoundProp(item: ImageItem, map: MapItem): ImageItem {
  const hasLocal = item.propMapLocalX != null && item.propMapLocalY != null;
  const local = hasLocal
    ? { x: item.propMapLocalX!, y: item.propMapLocalY! }
    : worldToMapLocal(item.x + item.width / 2, item.y + item.height / 2, map);
  const lx = hasLocal ? local.x : local.x - item.width / 2;
  const ly = hasLocal ? local.y : local.y - item.height / 2;
  const localRot =
    item.propMapLocalRotation != null
      ? item.propMapLocalRotation
      : item.rotation - map.rotation;
  const world = worldTopLeftFromLocal(lx, ly, item.width, item.height, map);
  return {
    ...item,
    dungeonPropForMapId: map.id,
    propMapLocalX: lx,
    propMapLocalY: ly,
    propMapLocalRotation: localRot,
    x: world.x,
    y: world.y,
    rotation: localRot + map.rotation,
  };
}

export function worldPatchForMapBoundProp(item: ImageItem, map: MapItem): Partial<ImageItem> {
  const lx = item.propMapLocalX ?? 0;
  const ly = item.propMapLocalY ?? 0;
  const w = worldTopLeftFromLocal(lx, ly, item.width, item.height, map);
  const localRot = item.propMapLocalRotation ?? item.rotation - map.rotation;
  return {
    x: w.x,
    y: w.y,
    rotation: localRot + map.rotation,
  };
}

/** Recompute world x/y (and rotation) for every prop bound to this map. */
export function mapBoundPropPatches(
  map: MapItem,
  items: Record<string, Item>,
): Array<{ id: string; patch: Partial<ImageItem> }> {
  const out: Array<{ id: string; patch: Partial<ImageItem> }> = [];
  for (const item of Object.values(items)) {
    if (!isMapBoundProp(item) || item.dungeonPropForMapId !== map.id) continue;
    out.push({ id: item.id, patch: worldPatchForMapBoundProp(item, map) });
  }
  return out;
}

/** After the GM drags a bound prop, refresh its map-local anchor. */
export function mapLocalPatchAfterPropMove(
  item: ImageItem,
  map: MapItem,
  x: number,
  y: number,
  rotation: number,
): Partial<ImageItem> {
  const mid = worldToMapLocal(x + item.width / 2, y + item.height / 2, map);
  return {
    x,
    y,
    rotation,
    propMapLocalX: mid.x - item.width / 2,
    propMapLocalY: mid.y - item.height / 2,
    propMapLocalRotation: rotation - map.rotation,
  };
}
