import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore, clampView3dOrbit, type MapViewMode } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import {
  applyViewport,
  fitMapItemToScreen,
  fitMapToScreen,
  syncMapGridFromItem,
} from '@/systems/map/hooks/useMapViewport';
import type { MapFocusPayload } from '@grimoire/shared';
import type { MapItem } from '@/systems/scene/types';

let mapFocusHandler: ((payload: MapFocusPayload) => void) | null = null;
let pendingMapFocus: MapFocusPayload | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

const FOCUS_RETRY_MS = 50;
const FOCUS_RETRY_MAX = 40;

function sid(): string | null {
  return useSessionStore.getState().sessionId;
}

function clearFocusRetry() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function buildMapFocusPayload(mapId: string, fitToMap: boolean): MapFocusPayload | null {
  const sessionId = sid();
  if (!sessionId) return null;
  const { viewport, view3dOrbit, viewMode } = useMapStore.getState();
  return {
    sessionId,
    mapId,
    viewport: { ...viewport },
    view3dOrbit: { ...view3dOrbit },
    viewMode,
    fitToMap,
  };
}

function applyMapFocusNow(payload: MapFocusPayload, map: MapItem) {
  useItemStore.getState().setActiveMap(payload.mapId);
  syncMapGridFromItem(map);
  useMapStore.getState().setView3dOrbit(clampView3dOrbit(payload.view3dOrbit));
  if (payload.viewMode) {
    useMapStore.getState().setViewMode(payload.viewMode as MapViewMode);
  }

  const run = () => {
    const app = sceneRefs.app.current;
    const world = sceneRefs.world.current;
    if (!app || !world) return false;
    if (payload.fitToMap) {
      fitMapItemToScreen(app, world, map);
    } else {
      applyViewport(world, payload.viewport);
    }
    return true;
  };

  if (!run()) requestAnimationFrame(() => { run(); });
}

function scheduleMapFocusRetry(payload: MapFocusPayload, attempt = 0) {
  pendingMapFocus = payload;
  if (attempt >= FOCUS_RETRY_MAX) return;
  clearFocusRetry();
  retryTimer = setTimeout(() => {
    const item = useItemStore.getState().items[payload.mapId];
    const app = sceneRefs.app.current;
    const world = sceneRefs.world.current;
    if (item?.type === 'map' && app && world) {
      pendingMapFocus = null;
      clearFocusRetry();
      applyMapFocusNow(payload, item as MapItem);
      return;
    }
    scheduleMapFocusRetry(payload, attempt + 1);
  }, FOCUS_RETRY_MS);
}

/** Apply queued map focus after items:sync (player). */
export function flushPendingMapFocus(): void {
  const payload = pendingMapFocus;
  if (!payload) return;
  const item = useItemStore.getState().items[payload.mapId];
  if (!item || item.type !== 'map') return;
  pendingMapFocus = null;
  clearFocusRetry();
  applyMapFocusNow(payload, item as MapItem);
}

export function emitMapFocusFromState(mapId: string, fitToMap: boolean, force = false): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  if (!force && !useMapStore.getState().syncPlayerViews) return;
  const payload = buildMapFocusPayload(mapId, fitToMap);
  if (!payload) return;
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit('map:focus', payload);
}

/** Apply remote map + camera (players only). */
export function applyMapFocus(payload: MapFocusPayload): void {
  if (useSessionStore.getState().myRole === 'GM') return;
  const sessionId = useSessionStore.getState().sessionId;
  if (payload.sessionId !== sessionId) return;

  const item = useItemStore.getState().items[payload.mapId];
  if (!item || item.type !== 'map') {
    scheduleMapFocusRetry(payload);
    return;
  }

  pendingMapFocus = null;
  clearFocusRetry();
  applyMapFocusNow(payload, item as MapItem);
}

export function bindMapFocusSocket(): void {
  const socket = getSocket();
  if (mapFocusHandler) socket.off('map:focus', mapFocusHandler);
  mapFocusHandler = (payload) => applyMapFocus(payload);
  socket.on('map:focus', mapFocusHandler);
}

/** GM: switch active map and optionally fit + push view to players. */
export function focusSessionMap(
  mapId: string,
  opts: { fitToMap?: boolean; select?: boolean; emit?: boolean } = {},
): void {
  const map = useItemStore.getState().items[mapId] as MapItem | undefined;
  if (!map || map.type !== 'map') return;

  useItemStore.getState().setActiveMap(mapId);
  syncMapGridFromItem(map);
  if (opts.select !== false) {
    useItemStore.getState().select([mapId], 'set');
  }

  const fitToMap = opts.fitToMap ?? false;
  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;

  const finish = () => {
    if (opts.emit !== false) emitMapFocusFromState(mapId, fitToMap);
  };

  if (fitToMap && app && world) {
    requestAnimationFrame(() => {
      fitMapItemToScreen(app, world, map);
      if (useMapStore.getState().viewMode === '3d') {
        useMapStore.getState().resetView3dOrbit();
      }
      finish();
    });
  } else {
    finish();
  }
}

/** GM: fit active map and push view to players (Reset View / Fit). */
export function resetSessionMapView(): void {
  const mapItem = useItemStore.getState().items[useItemStore.getState().activeMapId ?? ''];
  if (!mapItem || mapItem.type !== 'map') return;

  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  if (app && world) fitMapItemToScreen(app, world, mapItem);
  if (useMapStore.getState().viewMode === '3d') {
    useMapStore.getState().resetView3dOrbit();
  }
  emitMapFocusFromState(mapItem.id, true);
}

/** Push current map/view to players (e.g. after someone joins). */
export function syncMapFocusToSession(opts?: { force?: boolean }): void {
  const mapId = useItemStore.getState().activeMapId;
  if (!mapId) return;
  emitMapFocusFromState(mapId, false, opts?.force === true);
}
