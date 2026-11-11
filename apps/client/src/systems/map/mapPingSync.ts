import { v4 as uuidv4 } from 'uuid';
import type { MapPingPayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { ingestMapPing } from './mapPingStore';

let bound = false;
let lastEmitAt = 0;
const MIN_EMIT_MS = 180;

function onRemotePing(payload: MapPingPayload): void {
  const me = useSessionStore.getState().myUserId;
  if (me && payload.userId && payload.userId === me) return;
  ingestMapPing(payload);
}

export function bindMapPingSocket(): void {
  if (bound) return;
  bound = true;
  getSocket().on('map:ping', onRemotePing);
}

export function emitMapPing(worldX: number, worldY: number, lookHere: boolean): void {
  const now = Date.now();
  if (now - lastEmitAt < MIN_EMIT_MS) return;
  lastEmitAt = now;

  const { sessionId, myUserId, connectedUsers } = useSessionStore.getState();
  if (!sessionId) return;

  const userName =
    connectedUsers.find((u) => u.id === myUserId)?.username
    ?? (useSessionStore.getState().myRole === 'GM' ? 'GM' : 'Player');

  const payload: MapPingPayload = {
    sessionId,
    pingId: uuidv4(),
    x: worldX,
    y: worldY,
    userId: myUserId ?? 'local',
    userName,
    lookHere,
  };
  ingestMapPing(payload);
  getSocket().emit('map:ping', payload);
}
