/**
 * Mid-walk live pose — prop-proven item:update(live) + token:live + same-origin BC.
 * Interval publisher keeps remotes updating even when GLB frames hitch.
 * Persist once on key-release / blur. Never token:move mid-walk.
 */
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemUpdateLive } from '@/systems/scene/sceneSync';
import { emitTokenMove } from '@/systems/scene/token/tokenSync';
import { clearWalkPose } from '@/systems/scene/token/walkPoseBus';
import { applyWalkPoseVisual } from '@/systems/scene/token/remotePoseApply';
import { worldToGridColRow } from '@/systems/scene/token/tokenGrid';
import { bindPoseRelay } from '@/systems/scene/token/poseRelay';
import {
  bindWalkLiveIngress,
  broadcastWalkLiveLocal,
} from '@/systems/scene/token/walkLiveIngress';
import { firstPersonLook } from './firstPersonLook';
import { firstPersonPose, seedFirstPersonPose } from './firstPersonPose';
import { firstPersonMotion } from './firstPersonMotion';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import { fpGlobal } from './fpGlobals';
import type { TokenItem } from '@/systems/scene/types';

const NET_MS = 33;
let lastNetAt = 0;
let persistedThisStream = false;
let bound = false;
let lastEmitX = NaN;
let lastEmitY = NaN;
let emitCount = 0;
let netTimer: ReturnType<typeof setInterval> | null = null;

function ensureBound(): void {
  if (bound) return;
  bound = true;
  const socket = getSocket();
  bindPoseRelay(socket);
  bindWalkLiveIngress(socket);
}

function keysDown(): boolean {
  const k = firstPersonMotion.held;
  return k.has('w') || k.has('a') || k.has('s') || k.has('d')
    || k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright');
}

function emitLivePose(token: TokenItem): void {
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) {
    seedFirstPersonPose(token);
  }
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) return;

  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;

  const x = firstPersonPose.x;
  const y = firstPersonPose.y;
  const rotation = firstPersonLook.yaw;
  const cx = x + token.width / 2;
  const cy = y + token.height / 2;
  const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);

  applyWalkPoseVisual(token.id, x, y, rotation);
  lastEmitX = x;
  lastEmitY = y;
  emitCount += 1;

  const pose = { sessionId, tokenId: token.id, x, y, rotation, gridCol, gridRow };

  // Same-origin GM/player tabs — works even if socket briefly drops.
  broadcastWalkLiveLocal(pose);

  // Proven prop-drag channel (primary).
  emitItemUpdateLive([{
    id: token.id,
    patch: { x, y, rotation, gridCol, gridRow },
  }]);

  const socket = getSocket();
  if (!socket.connected) {
    if (emitCount === 1 || emitCount % 30 === 0) {
      console.warn('[FP walk] emit skipped — socket disconnected', emitCount);
    }
    return;
  }

  // Lightweight dedicated relays (backup if item:update is filtered).
  socket.emit('token:live', pose);
  socket.emit('fp:pose', pose);

  if (emitCount === 1 || emitCount % 30 === 0) {
    console.info('[FP walk] emit', emitCount, x.toFixed(0), y.toFixed(0), socket.id);
  }
}

function pumpNetwork(): void {
  if (!keysDown() && Math.hypot(firstPersonMotion.velX, firstPersonMotion.velY) <= 0.5) {
    return;
  }
  const token = resolveFirstPersonToken();
  if (!token) return;
  tickFpPoseNetwork(token, true);
}

export function isFpWalkStreaming(): boolean {
  return fpGlobal.walkStreaming;
}

/** Call every FP camera frame while moving — live packets only. */
export function tickFpPoseNetwork(token: TokenItem, moving: boolean): void {
  ensureBound();
  if (!moving) return;

  const now = performance.now();
  fpGlobal.walkStreaming = true;
  persistedThisStream = false;

  const jumped = !Number.isFinite(lastEmitX)
    || Math.hypot(firstPersonPose.x - lastEmitX, firstPersonPose.y - lastEmitY) > 0.25;
  if (jumped || now - lastNetAt >= NET_MS) {
    lastNetAt = now;
    emitLivePose(token);
  }
}

/**
 * Authoritative token:move after movement keys release.
 * Callers must not clear walkStreaming before this.
 */
export function flushFpPosePersist(): void {
  if (keysDown()) return;

  const token = resolveFirstPersonToken();
  const tokenId = firstPersonPose.tokenId ?? token?.id ?? null;

  if (persistedThisStream) {
    if (tokenId) clearWalkPose(tokenId);
    fpGlobal.walkStreaming = false;
    return;
  }

  const hadLiveMotion = fpGlobal.walkStreaming || emitCount > 0;
  if (!hadLiveMotion) {
    if (tokenId) clearWalkPose(tokenId);
    fpGlobal.walkStreaming = false;
    return;
  }

  if (!token || !firstPersonPose.active || firstPersonPose.tokenId !== token.id) {
    if (tokenId) clearWalkPose(tokenId);
    fpGlobal.walkStreaming = false;
    return;
  }

  persistedThisStream = true;
  fpGlobal.walkStreaming = false;
  emitLivePose(token);

  const cx = firstPersonPose.x + token.width / 2;
  const cy = firstPersonPose.y + token.height / 2;
  const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);
  emitTokenMove(token.id, gridCol, gridRow, firstPersonPose.x, firstPersonPose.y, {
    persist: true,
  });
  clearWalkPose(token.id);
  lastEmitX = NaN;
  lastEmitY = NaN;
  emitCount = 0;
}

export function startFpPosePublisher(): void {
  ensureBound();
  fpGlobal.walkStreaming = false;
  persistedThisStream = false;
  lastNetAt = 0;
  lastEmitX = NaN;
  lastEmitY = NaN;
  emitCount = 0;
  const token = resolveFirstPersonToken();
  if (token) seedFirstPersonPose(token);
  if (netTimer == null) {
    netTimer = setInterval(pumpNetwork, NET_MS);
  }
}

export function stopFpPosePublisher(): void {
  if (netTimer != null) {
    clearInterval(netTimer);
    netTimer = null;
  }
  const tokenId = firstPersonPose.tokenId ?? resolveFirstPersonToken()?.id ?? null;
  flushFpPosePersist();
  if (tokenId) clearWalkPose(tokenId);
  lastNetAt = 0;
  lastEmitX = NaN;
  lastEmitY = NaN;
  emitCount = 0;
  persistedThisStream = false;
  fpGlobal.walkStreaming = false;
}
