import { getSocket } from '@/lib/socket';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { flushFogScene } from './fogSync';

let fogActiveHandler: ((payload: { active: boolean; sessionId?: string }) => void) | null = null;

/** Whether the fog overlay should render for the current client. */
export function isFogOverlayVisible(): boolean {
  const { fogEnabled, sessionFogActive } = useMapStore.getState();
  return fogEnabled || sessionFogActive;
}

export function emitFogActive(active: boolean): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || useSessionStore.getState().myRole !== 'GM') return;
  if (!getSocket().connected) return;
  getSocket().emit('fog:active', { sessionId, active });
}

/** GM toggles fog visibility for the whole table. */
export function setFogVisibleForSession(visible: boolean): void {
  const wasOn = isFogOverlayVisible();
  const store = useMapStore.getState();
  store.setFogEnabled(visible);
  store.setSessionFogActive(visible);

  // Fresh black fog for everyone — clears stray revealed cells from vision/local cache.
  if (visible && !wasOn && useSessionStore.getState().myRole === 'GM') {
    store.setRevealedCells(new Set(), { persist: false });
    flushFogScene();
  }

  if (useSessionStore.getState().myRole === 'GM') {
    emitFogActive(visible);
  }
}

export function applySessionFogActive(active: boolean): void {
  const role = useSessionStore.getState().myRole;
  const wasOn = isFogOverlayVisible();
  useMapStore.getState().setSessionFogActive(active);
  if (active && !wasOn) {
    useMapStore.getState().setRevealedCells(new Set(), { persist: false });
  }
  if (role !== 'GM') {
    useMapStore.getState().setFogEnabled(active);
  } else if (active) {
    // Secondary GM clients (e.g. phone) need fogEnabled so the overlay renders on desktop too.
    useMapStore.getState().setFogEnabled(true);
  }
}

export function bindFogActiveSocket(): void {
  const socket = getSocket();
  if (fogActiveHandler) {
    socket.off('fog:active', fogActiveHandler);
  }
  fogActiveHandler = ({ active, sessionId }) => {
    const sid = useSessionStore.getState().sessionId;
    if (sessionId != null && sid != null && sessionId !== sid) return;
    applySessionFogActive(active);
  };
  socket.on('fog:active', fogActiveHandler);
}

/** Push current fog visibility to players (call after socket connects). */
export function syncFogActiveToSession(): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  emitFogActive(isFogOverlayVisible());
}
