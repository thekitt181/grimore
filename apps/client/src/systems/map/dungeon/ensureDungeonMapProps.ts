import type { ImageItem, Item, MapItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemAdd, emitItemRemove, emitItemUpdate } from '@/systems/scene/sceneSync';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import { isDoorPropId } from '@/systems/map/props/doorCollision';
import { canonicalPropId } from '@/systems/map/props/propArt';
import { bindMapBoundProp } from '@/systems/map/props/mapBoundProps';
import { buildDungeonPropItems } from './dungeonPropSpawn';
import { buildDungeonDoorItems } from './dungeonDoorSpawn';
import { regenerateDungeonForMap } from './dungeonLayoutFromMap';

/** Bump when spawn rules change so GMs can refresh auto props. */
export const DUNGEON_PROPS_SPAWN_REVISION = 2;
/** Bump when door spawn rules change (runs independently of props). */
export const DUNGEON_DOORS_SPAWN_REVISION = 2;

function propCenterOnMap(map: MapItem, item: ImageItem): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return cx >= map.x && cx <= map.x + map.width && cy >= map.y && cy <= map.y + map.height;
}

function legacyPropsLikelyPresent(map: MapItem, items: Record<string, Item>): boolean {
  let n = 0;
  for (const item of Object.values(items)) {
    if (item.type !== 'image' || !item.propId) continue;
    if (propCenterOnMap(map, item)) n += 1;
    if (n >= 2) return true;
  }
  return false;
}

function patchDungeonLink(
  mapId: string,
  map: MapItem,
  patchLink: Partial<NonNullable<MapItem['dungeon']>>,
): void {
  const dungeon = { ...map.dungeon!, ...patchLink };
  const patch = { dungeon } as Partial<Item>;
  useItemStore.getState().updateItem(mapId, patch);
  emitItemUpdate([{ id: mapId, patch }]);
}

function tagPropItems(items: ImageItem[], map: MapItem): ImageItem[] {
  return items.map((item) => bindMapBoundProp(item, map));
}

function hasAutoPropsForMap(mapId: string, items: Record<string, Item>): boolean {
  return Object.values(items).some(
    (i) => i.type === 'image' && i.dungeonPropForMapId === mapId,
  );
}

function isAutoDoorProp(item: ImageItem): boolean {
  const propId = resolvePropId(item);
  if (!propId) return false;
  const id = canonicalPropId(propId);
  return isDoorPropId(id) || id === 'hatch' || id === 'gate' || id === 'secret-door' || id === 'runed-door';
}

/** Drop note-driven floor props so a spawn-revision bump can re-place (doors handled separately). */
function removeAutoFloorPropsForMap(mapId: string): void {
  const store = useItemStore.getState();
  const ids: string[] = [];
  for (const item of Object.values(store.items)) {
    if (item.type !== 'image' || item.dungeonPropForMapId !== mapId) continue;
    if (isAutoDoorProp(item)) continue;
    ids.push(item.id);
  }
  if (ids.length === 0) return;
  store.removeItems(ids);
  emitItemRemove(ids);
}

/** Clear previous auto doors before re-spawn (avoids stacked overlapping doors). */
function removeAutoDoorsForMap(mapId: string): void {
  const store = useItemStore.getState();
  const ids: string[] = [];
  for (const item of Object.values(store.items)) {
    if (item.type !== 'image' || item.dungeonPropForMapId !== mapId) continue;
    if (!isAutoDoorProp(item)) continue;
    ids.push(item.id);
  }
  if (ids.length === 0) return;
  store.removeItems(ids);
  emitItemRemove(ids);
}

/**
 * GM-only: place note-driven props on this dungeon map once (current + older maps without revision).
 */
/** Older auto props only had `dungeonPropForMapId` — attach map-local anchors once. */
function migrateLegacyMapBoundProps(map: MapItem): void {
  const store = useItemStore.getState();
  const patches: Array<{ id: string; patch: Partial<ImageItem> }> = [];
  for (const item of Object.values(store.items)) {
    if (item.type !== 'image' || item.dungeonPropForMapId !== map.id) continue;
    if (item.propMapLocalX != null && item.propMapLocalY != null) continue;
    patches.push({ id: item.id, patch: bindMapBoundProp(item, map) });
  }
  if (!patches.length) return;
  store.updateItems(patches);
  emitItemUpdate(patches);
}

export function ensureDungeonMapProps(mapId: string): void {
  if (useSessionStore.getState().myRole !== 'GM') return;

  const map = useItemStore.getState().items[mapId];
  if (!map || map.type !== 'map' || !map.dungeon) return;

  migrateLegacyMapBoundProps(map);

  const link = map.dungeon;
  const needsDoors = link.doorsSpawnRevision !== DUNGEON_DOORS_SPAWN_REVISION;
  const needsProps = link.propsSpawnRevision !== DUNGEON_PROPS_SPAWN_REVISION;
  if (!needsDoors && !needsProps) return;

  const dungeon = regenerateDungeonForMap(map);
  if (!dungeon) return;

  const store = useItemStore.getState();
  let roomsSnapshot: NonNullable<MapItem['dungeon']>['rooms'] | undefined;

  if (needsDoors) {
    removeAutoDoorsForMap(mapId);
    const doorItems = tagPropItems(buildDungeonDoorItems(map, dungeon), map);
    for (const prop of doorItems) {
      store.addItem(prop);
      emitItemAdd(prop);
    }
    const fresh = useItemStore.getState().items[mapId] as MapItem;
    patchDungeonLink(mapId, fresh, { doorsSpawnRevision: DUNGEON_DOORS_SPAWN_REVISION });
  }

  if (!needsProps) return;

  const items = useItemStore.getState().items;
  const hadAutoProps = hasAutoPropsForMap(mapId, items);
  if (hadAutoProps) {
    removeAutoFloorPropsForMap(mapId);
  } else if (legacyPropsLikelyPresent(map, items)) {
    patchDungeonLink(mapId, map, { propsSpawnRevision: DUNGEON_PROPS_SPAWN_REVISION });
    return;
  }

  const propItems = tagPropItems(buildDungeonPropItems(map, dungeon), map);
  for (const prop of propItems) {
    store.addItem(prop);
    emitItemAdd(prop);
  }

  roomsSnapshot = dungeon.rooms.map((room) => ({
    id: room.id,
    x: room.x,
    y: room.y,
    w: room.w,
    h: room.h,
    title: room.title,
    notes: [...room.notes],
  }));
  const freshMap = useItemStore.getState().items[mapId] as MapItem;
  patchDungeonLink(mapId, freshMap, {
    propsSpawnRevision: DUNGEON_PROPS_SPAWN_REVISION,
    rooms: roomsSnapshot,
  });
}

export function ensureDungeonMapPropsForActiveMap(): void {
  const mapId = useItemStore.getState().activeMapId;
  if (!mapId) return;
  ensureDungeonMapProps(mapId);
}
