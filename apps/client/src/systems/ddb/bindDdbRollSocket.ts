import type { DdbRollBridgePayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useDiceStore } from '@/systems/dice/diceStore';

let ddbRollHandler: ((payload: DdbRollBridgePayload) => void) | null = null;
let boundSocketId: string | null = null;

/** Attach ddb:roll listener to the current socket (re-binds after reconnect). */
export function bindDdbRollSocket(force = false): void {
  const socket = getSocket();
  if (ddbRollHandler && boundSocketId === socket.id && !force) return;

  if (ddbRollHandler) {
    socket.off('ddb:roll', ddbRollHandler);
  }

  ddbRollHandler = (payload: DdbRollBridgePayload) => {
    const { sessionId } = useSessionStore.getState();
    if (!sessionId || payload.sessionId !== sessionId) return;
    console.info('[DDB] roll received:', payload.characterName, payload.label, payload.total);
    useDiceStore.getState().addDdbRollEntry(payload);
  };

  socket.on('ddb:roll', ddbRollHandler);
  boundSocketId = socket.id ?? null;
}

export function unbindDdbRollSocket(): void {
  if (!ddbRollHandler) return;
  getSocket().off('ddb:roll', ddbRollHandler);
  ddbRollHandler = null;
  boundSocketId = null;
}
