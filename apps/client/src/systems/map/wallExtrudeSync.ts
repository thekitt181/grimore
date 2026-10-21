import { getSocket } from '@/lib/socket';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { isMapSurfaceStyleId } from '@/systems/map3d/mapSurfaceStyles';
import type { WallExtrudePayload } from '@grimoire/shared';

let wallExtrudeHandler: ((payload: WallExtrudePayload) => void) | null = null;

function currentPayload(sessionId: string): WallExtrudePayload {
  const s = useMapStore.getState();
  return {
    sessionId,
    autoExtrudeWalls: s.autoExtrudeWalls,
    wallHeightCells: s.wallHeightCells,
    scanImageWalls: s.scanImageWalls,
    wallStyleId: s.wallStyleId,
    floorStyleId: s.floorStyleId,
  };
}

/** GM pushes extrude-wall settings so players render the same 3D walls. */
export function emitWallExtrudeToSession(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || useSessionStore.getState().myRole !== 'GM') return;
  if (!getSocket().connected) return;
  getSocket().emit('map:wallExtrude', currentPayload(sessionId));
}

export function applyWallExtrudeFromSession(payload: WallExtrudePayload): void {
  const store = useMapStore.getState();
  store.setAutoExtrudeWalls(Boolean(payload.autoExtrudeWalls));
  if (typeof payload.wallHeightCells === 'number' && Number.isFinite(payload.wallHeightCells)) {
    store.setWallHeightCells(payload.wallHeightCells);
  }
  store.setScanImageWalls(Boolean(payload.scanImageWalls));
  if (isMapSurfaceStyleId(payload.wallStyleId)) {
    store.setWallStyleId(payload.wallStyleId);
  }
  if (isMapSurfaceStyleId(payload.floorStyleId)) {
    store.setFloorStyleId(payload.floorStyleId);
  }
}

export function bindWallExtrudeSocket(): void {
  const socket = getSocket();
  if (wallExtrudeHandler) {
    socket.off('map:wallExtrude', wallExtrudeHandler);
  }
  wallExtrudeHandler = (payload) => {
    const sid = useSessionStore.getState().sessionId;
    if (payload.sessionId != null && sid != null && payload.sessionId !== sid) return;
    // GM already has local truth — still apply so secondary GM clients stay aligned.
    applyWallExtrudeFromSession(payload);
  };
  socket.on('map:wallExtrude', wallExtrudeHandler);
}

/** Push current extrude settings after connect (GM only). */
export function syncWallExtrudeToSession(): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  emitWallExtrudeToSession();
}
