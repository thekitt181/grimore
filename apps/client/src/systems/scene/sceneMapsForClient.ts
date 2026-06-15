import type { Item, MapItem, TokenItem } from './types';

/** Visible to players on the shared table (false = GM-only ghost). */
export function isSceneItemShared(item: Item): boolean {
  return item.visible !== false;
}

/** Shared table item, or GM-only ghost when gm=true. */
export function isSceneItemOnTable(item: Item, gm: boolean): boolean {
  return isSceneItemShared(item) || gm;
}

/** All maps on the shared canvas — same layout for GM and players; GM also sees hidden maps. */
export function sceneMapsForClient(items: readonly Item[], gm = false): MapItem[] {
  return items.filter(
    (i): i is MapItem => i.type === 'map' && isSceneItemOnTable(i, gm),
  );
}

/** All tokens on the shared canvas — fog may dim the map but does not hide minis. */
export function sceneTokensForClient(
  items: readonly Item[] | Record<string, Item>,
  gm = false,
): TokenItem[] {
  const list = Array.isArray(items) ? items : Object.values(items);
  return list.filter(
    (i): i is TokenItem => i.type === 'token' && isSceneItemOnTable(i, gm),
  );
}

/** @deprecated use sceneMapsForClient(items) — gm/activeMap args ignored. */
export function sceneMapsForClientLegacy(
  items: readonly Item[],
  _activeMapId: string | null,
  _gm: boolean,
): MapItem[] {
  return sceneMapsForClient(items);
}
