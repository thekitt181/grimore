import { getSocket } from '@/lib/socket';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';

export function emitFogActive(active: boolean): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || useSessionStore.getState().myRole !== 'GM') return;
  getSocket().emit('fog:active', { sessionId, active });
}

export function bindFogActiveSocket(): void {
  const socket = getSocket();
  socket.off('fog:active');
  socket.on('fog:active', ({ active }) => {
    useMapStore.getState().setSessionFogActive(active);
    if (useSessionStore.getState().myRole === 'GM') {
      useMapStore.getState().setFogEnabled(active);
    }
  });
}
