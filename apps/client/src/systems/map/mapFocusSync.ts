import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore, clampView3dOrbit, type MapViewMode } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { applyViewport, fitMapToScreen } from '@/systems/map/hooks/useMapViewport';
import type { MapFocusPayload } from '@grimoire/shared';
import type { MapItem } from '@/systems/scene/types';

let mapFocusHandler: ((payload: MapFocusPayload) => void) | null = null;

function sid(): string | null {
  return useSessionStore.getState().sessionId;
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

export function emitMapFocusFromState(mapId: string, fitToMap: boolean): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  if (!useMapStore.getState().syncPlayerViews) return;
  const payload = buildMapFocusPayload(mapId, fitToMap);
  if (!payload) return;
  const socket = getSocket();
  if (!socket.connected) return;
  socket.emit('map:focus', payload);
}

/** Apply remote map + camera (players only). */
export function applyMapFocus(payload: MapFocusPayload): void {
  if (useSessionStore.getState().myRole === 'GM') return;
  const sid = useSessionStore.getState().sessionId;
  if (payload.sessionId !== sid) return;

  const item = useItemStore.getState().items[payload.mapId];
  if (!item || item.type !== 'map') return;

  useItemStore.getState().setActiveMap(payload.mapId);
  useMapStore.getState().setView3dOrbit(clampView3dOrbit(payload.view3dOrbit));
  if (payload.viewMode) {
    useMapStore.getState().setViewMode(payload.viewMode as MapViewMode);
  }

  const applyView = () => {
    const app = sceneRefs.app.current;
    const world = sceneRefs.world.current;
    if (!app || !world) return;
    if (payload.fitToMap) {
      fitMapToScreen(app, world);
    } else {
      applyViewport(world, payload.viewport);
    }
  };

  requestAnimationFrame(() => requestAnimationFrame(applyView));
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
      fitMapToScreen(app, world);
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
  const map = useItemStore.getState().items[useItemStore.getState().activeMapId ?? ''];
  const mapId = map?.type === 'map' ? map.id : null;
  if (!mapId) return;

  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  if (app && world) fitMapToScreen(app, world);
  if (useMapStore.getState().viewMode === '3d') {
    useMapStore.getState().resetView3dOrbit();
  }
  emitMapFocusFromState(mapId, true);
}

/** Push current map/view to players (e.g. after someone joins). */
export function syncMapFocusToSession(): void {
  const mapId = useItemStore.getState().activeMapId;
  if (!mapId) return;
  emitMapFocusFromState(mapId, true);
}
