import type { Item, MapItem, TokenItem } from './types';
import { filterPlayerTokens } from './token/clientTokenVisibility';
import { isFogOverlayVisible } from './fogActiveSync';
import { getActiveMap, useItemStore } from './store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';

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

/** Tokens rendered for this client — players only see tokens in live vision when fog is on. */
export function sceneTokensForClient(
  items: readonly Item[] | Record<string, Item>,
  gm = false,
): TokenItem[] {
  const list = Array.isArray(items) ? items : Object.values(items);
  const onTable = list.filter(
    (i): i is TokenItem => i.type === 'token' && isSceneItemOnTable(i, gm),
  );

  if (gm || !isFogOverlayVisible()) {
    return onTable;
  }

  const record: Record<string, Item> = Array.isArray(items)
    ? Object.fromEntries(list.map((i) => [i.id, i]))
    : { ...items };

  const fogVisible = filterPlayerTokens(record, {
    myUserId: useSessionStore.getState().myUserId,
    selectedIds: useItemStore.getState().selectedIds,
    revealedCells: useMapStore.getState().revealedCells,
    activeMap: getActiveMap(),
  });
  const fogIds = new Set(fogVisible.map((t) => t.id));
  return onTable.filter((t) => fogIds.has(t.id));
}

/** Token ids that should render for this client (`null` = GM, no fog filter). */
export function clientVisibleTokenIdSet(
  items: readonly Item[] | Record<string, Item>,
  gm: boolean,
): Set<string> | null {
  if (gm) return null;
  return new Set(sceneTokensForClient(items, false).map((t) => t.id));
}

/** @deprecated use sceneMapsForClient(items) — gm/activeMap args ignored. */
export function sceneMapsForClientLegacy(
  items: readonly Item[],
  _activeMapId: string | null,
  _gm: boolean,
): MapItem[] {
  return sceneMapsForClient(items);
}
