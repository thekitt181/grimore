import { getSocket } from '@/lib/socket';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';

let fogActiveHandler: ((payload: { active: boolean }) => void) | null = null;

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
  const store = useMapStore.getState();
  store.setFogEnabled(visible);
  store.setSessionFogActive(visible);
  if (useSessionStore.getState().myRole === 'GM') {
    emitFogActive(visible);
  }
}

export function applySessionFogActive(active: boolean): void {
  const role = useSessionStore.getState().myRole;
  if (role === 'GM') return;
  useMapStore.getState().setSessionFogActive(active);
  useMapStore.getState().setFogEnabled(active);
}

export function bindFogActiveSocket(): void {
  const socket = getSocket();
  if (fogActiveHandler) {
    socket.off('fog:active', fogActiveHandler);
  }
  fogActiveHandler = ({ active }) => {
    applySessionFogActive(active);
  };
  socket.on('fog:active', fogActiveHandler);
}

/** Push current fog visibility to players (call after socket connects). */
export function syncFogActiveToSession(): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  emitFogActive(isFogOverlayVisible());
}
