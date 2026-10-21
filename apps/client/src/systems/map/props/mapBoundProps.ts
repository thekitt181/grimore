import type { ImageItem, Item, MapItem } from '@/systems/scene/types';
import { mapLocalToWorld, worldToMapLocal } from '@/systems/map/wallUtils';

export function isMapBoundProp(item: Item): item is ImageItem {
  if (item.type !== 'image' || !item.dungeonPropForMapId) return false;
  return item.propMapLocalX != null && item.propMapLocalY != null;
}

/** Auto-spawned props: store map-local pose and spawn locked. */
export function bindMapBoundProp(item: ImageItem, map: MapItem): ImageItem {
  const hasLocal = item.propMapLocalX != null && item.propMapLocalY != null;
  const local = hasLocal
    ? { x: item.propMapLocalX!, y: item.propMapLocalY! }
    : worldToMapLocal(item.x, item.y, map);
  const localRot =
    item.propMapLocalRotation != null
      ? item.propMapLocalRotation
      : item.rotation - map.rotation;
  const world = mapLocalToWorld(local.x, local.y, map);
  return {
    ...item,
    dungeonPropForMapId: map.id,
    propMapLocalX: local.x,
    propMapLocalY: local.y,
    propMapLocalRotation: localRot,
    x: world.x,
    y: world.y,
    rotation: localRot + map.rotation,
    locked: true,
  };
}

export function worldPatchForMapBoundProp(item: ImageItem, map: MapItem): Partial<ImageItem> {
  const lx = item.propMapLocalX ?? 0;
  const ly = item.propMapLocalY ?? 0;
  const w = mapLocalToWorld(lx, ly, map);
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
  const local = worldToMapLocal(x, y, map);
  return {
    x,
    y,
    rotation,
    propMapLocalX: local.x,
    propMapLocalY: local.y,
    propMapLocalRotation: rotation - map.rotation,
  };
}
