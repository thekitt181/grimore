import type { Socket } from 'socket.io-client';
import type {
  PropInteractRequestPayload,
  PropInteractResolveAction,
  PropInteractResolvePayload,
} from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { ingestPropInteractResolve, openGmPropInteractPrompt } from './fpPropInteract';
import { usePropInteractRequestStore } from './propInteractRequestStore';

let bound: Socket | null = null;

function onRequest(payload: PropInteractRequestPayload) {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || payload.sessionId !== sessionId) return;
  if (useSessionStore.getState().myRole !== 'GM') return;
  openGmPropInteractPrompt({
    requestId: payload.requestId,
    propItemId: payload.propItemId,
    actorTokenId: payload.actorTokenId,
    requesterUserId: payload.requesterUserId,
    requesterName: payload.requesterName,
    propName: payload.propName,
    at: payload.at,
  });
}

function onResolve(payload: PropInteractResolvePayload) {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || payload.sessionId !== sessionId) return;
  ingestPropInteractResolve(payload.requestId, payload.action);
}

export function bindPropInteractSync(socket: Socket = getSocket()): void {
  if (bound === socket) return;
  if (bound) unbindPropInteractSync(bound);
  bound = socket;
  socket.on('prop:interactRequest', onRequest as never);
  socket.on('prop:interactResolve', onResolve as never);
}

export function unbindPropInteractSync(socket: Socket = getSocket()): void {
  socket.off('prop:interactRequest', onRequest as never);
  socket.off('prop:interactResolve', onResolve as never);
  if (bound === socket) bound = null;
}

export function emitPropInteractRequest(
  sessionId: string,
  body: Omit<PropInteractRequestPayload, 'sessionId'>,
): void {
  getSocket().emit('prop:interactRequest', { sessionId, ...body });
}

export function emitPropInteractResolve(
  sessionId: string,
  requestId: string,
  action: PropInteractResolveAction,
): void {
  getSocket().emit('prop:interactResolve', { sessionId, requestId, action });
}
