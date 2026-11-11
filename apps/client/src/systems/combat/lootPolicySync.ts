import { getSocket } from '@/lib/socket';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';

let lootPolicyHandler: ((payload: { sessionId?: string; playersCanLoot: boolean }) => void) | null = null;

export function emitLootPolicy(playersCanLoot: boolean): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || useSessionStore.getState().myRole !== 'GM') return;
  if (!getSocket().connected) return;
  getSocket().emit('loot:player-take', { sessionId, playersCanLoot });
}

export function setPlayersCanLootForSession(enabled: boolean): void {
  useMapStore.getState().setPlayersCanLoot(enabled);
  if (useSessionStore.getState().myRole === 'GM') emitLootPolicy(enabled);
}

export function bindLootPolicySocket(): void {
  const socket = getSocket();
  if (lootPolicyHandler) socket.off('loot:player-take', lootPolicyHandler);
  lootPolicyHandler = ({ sessionId, playersCanLoot }) => {
    const sid = useSessionStore.getState().sessionId;
    if (sessionId != null && sid != null && sessionId !== sid) return;
    useMapStore.getState().setPlayersCanLoot(Boolean(playersCanLoot));
  };
  socket.on('loot:player-take', lootPolicyHandler);
}

export function syncLootPolicyToSession(): void {
  if (useSessionStore.getState().myRole !== 'GM') return;
  emitLootPolicy(useMapStore.getState().playersCanLoot);
}
