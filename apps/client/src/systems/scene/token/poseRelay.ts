/**
 * Live FP walk / look — mesh apply only (no Zustand mid-stride).
 * Listens on fp:pose (dedicated) + token:rotate+xy + token:live.
 */
import type { Socket } from 'socket.io-client';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { applyRemoteWalkPose } from '@/systems/scene/token/remotePoseApply';
import { isStaleLiveAfterLocalCommit } from '@/systems/scene/token/tokenMoveCommitGuard';

let boundSocket: Socket | null = null;

function ignoreLocalDriver(tokenId: string): boolean {
  const fp = useFirstPersonStore.getState();
  return Boolean(fp.enabled && fp.tokenId === tokenId);
}

function applyPose(payload: {
  sessionId?: string;
  tokenId?: string;
  rotation?: number;
  x?: number;
  y?: number;
}): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId || payload.sessionId !== sessionId) return;
  if (payload.tokenId == null) return;
  if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
  if (ignoreLocalDriver(payload.tokenId)) return;
  if (isStaleLiveAfterLocalCommit(payload.tokenId, payload.x, payload.y)) return;
  applyRemoteWalkPose(
    payload.tokenId,
    payload.x,
    payload.y,
    payload.rotation,
  );
}

function onRotate(payload: {
  sessionId?: string;
  tokenId?: string;
  rotation?: number;
  x?: number;
  y?: number;
}): void {
  if (payload.rotation == null) return;
  applyPose(payload);
}

function onLive(payload: {
  sessionId?: string;
  tokenId?: string;
  rotation?: number;
  x?: number;
  y?: number;
}): void {
  applyPose(payload);
}

function onFpPose(payload: {
  sessionId?: string;
  tokenId?: string;
  rotation?: number;
  x?: number;
  y?: number;
}): void {
  applyPose(payload);
}

export function bindPoseRelay(socket: Socket): void {
  socket.off('token:rotate', onRotate as never);
  socket.off('token:live', onLive as never);
  socket.off('fp:pose', onFpPose as never);
  boundSocket = socket;
  socket.on('token:rotate', onRotate as never);
  socket.on('token:live', onLive as never);
  socket.on('fp:pose', onFpPose as never);
}

export function rebindPoseRelay(): void {
  if (boundSocket) bindPoseRelay(boundSocket);
}
