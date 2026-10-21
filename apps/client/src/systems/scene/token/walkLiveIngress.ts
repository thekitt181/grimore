/**
 * Permanent walk-live ingress — bound once on the socket (not React effect churn).
 * Applies the same way prop drag works: walkPose + liveTransform + soft item write.
 */
import type { Socket } from 'socket.io-client';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { applyRemoteWalkPose } from '@/systems/scene/token/remotePoseApply';
import { getWalkPose } from '@/systems/scene/token/walkPoseBus';

let bound: Socket | null = null;
let bc: BroadcastChannel | null = null;

const softWriteAt = new Map<string, number>();
const SOFT_WRITE_MS = 100;
/** Fog / React tick — keep rare so mid-walk doesn't hitch. */
const FOG_TICK_MS = 120;
let lastFogTickAt = 0;
let ingestLog = 0;

function ignoreLocal(tokenId: string): boolean {
  const fp = useFirstPersonStore.getState();
  return Boolean(fp.enabled && fp.tokenId === tokenId);
}

/** Soft item-store write so Pixi/React see mid-walk feet (throttled — not every packet). */
function softCommitItem(tokenId: string, x: number, y: number, rotation?: number): void {
  const now = performance.now();
  const last = softWriteAt.get(tokenId) ?? 0;
  if (now - last < SOFT_WRITE_MS) return;
  softWriteAt.set(tokenId, now);
  const patch: { x: number; y: number; rotation?: number } = { x, y };
  if (rotation != null) patch.rotation = rotation;
  useItemStore.getState().updateItem(tokenId, patch);
}

export type WalkLiveIngest = {
  sessionId?: string;
  tokenId?: string;
  id?: string;
  x?: number;
  y?: number;
  rotation?: number;
};

export function ingestWalkLive(payload: WalkLiveIngest): void {
  const mine = useSessionStore.getState().sessionId;
  if (!mine) return;
  // Room already scoped by socket.io — missing sessionId is OK (same-tab BC / legacy relays).
  if (payload.sessionId != null && payload.sessionId !== mine) return;

  const tokenId = payload.tokenId ?? payload.id;
  if (!tokenId) return;
  if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
  if (ignoreLocal(tokenId)) return;

  const x = payload.x;
  const y = payload.y;
  const rotation = payload.rotation;

  // 1) Walk-bus target — Three/Pixi interpolate toward this every frame
  applyRemoteWalkPose(tokenId, x, y, rotation);

  // 2) Live store without fog thrash every packet
  const now = performance.now();
  const bumpFog = now - lastFogTickAt >= FOG_TICK_MS;
  if (bumpFog) lastFogTickAt = now;
  useLiveTransformStore.getState().setLive(
    tokenId,
    {
      x,
      y,
      ...(rotation != null ? { rotation } : {}),
    },
    { bumpTick: bumpFog },
  );

  // 3) Throttled item write so Pixi useItemRenderer / fog catch up
  softCommitItem(tokenId, x, y, rotation);

  ingestLog += 1;
  if (ingestLog === 1 || ingestLog % 60 === 0) {
    console.info('[FP walk] ingest', ingestLog, tokenId.slice(0, 8), x.toFixed(0), y.toFixed(0));
  }
}

function onFpPose(payload: Record<string, unknown>): void {
  ingestWalkLive(payload as never);
}

function onTokenLive(payload: Record<string, unknown>): void {
  ingestWalkLive(payload as never);
}

function onTokenRotate(payload: Record<string, unknown>): void {
  if (typeof payload.x !== 'number' || typeof payload.y !== 'number') return;
  ingestWalkLive(payload as never);
}

function onMapTokenMove(payload: Record<string, unknown>): void {
  ingestWalkLive(payload as never);
}

function onItemUpdate(payload: {
  sessionId?: string;
  live?: boolean;
  patches?: Array<{ id: string; patch: { x?: number; y?: number; rotation?: number } }>;
}): void {
  if (!payload.live) return;
  const mine = useSessionStore.getState().sessionId;
  if (!mine) return;
  if (payload.sessionId != null && payload.sessionId !== mine) return;

  for (const { id, patch } of payload.patches ?? []) {
    if (typeof patch.x !== 'number' || typeof patch.y !== 'number') continue;
    const next: WalkLiveIngest = {
      sessionId: payload.sessionId ?? mine,
      tokenId: id,
      x: patch.x,
      y: patch.y,
    };
    if (patch.rotation != null) next.rotation = patch.rotation;
    ingestWalkLive(next);
  }
}

function onBroadcast(ev: MessageEvent): void {
  const data = ev.data as {
    sessionId?: string;
    tokenId?: string;
    x?: number;
    y?: number;
    rotation?: number;
  } | null;
  if (!data) return;
  ingestWalkLive(data);
}

function attachHandlers(socket: Socket): void {
  // Always rebind (poseRelay style) so reconnect / HMR can't leave us deaf.
  socket.off('fp:pose', onFpPose as never);
  socket.off('token:live', onTokenLive as never);
  socket.off('token:rotate', onTokenRotate as never);
  socket.off('map:tokenMove', onMapTokenMove as never);
  socket.off('item:update', onItemUpdate as never);
  socket.on('fp:pose', onFpPose as never);
  socket.on('token:live', onTokenLive as never);
  socket.on('token:rotate', onTokenRotate as never);
  socket.on('map:tokenMove', onMapTokenMove as never);
  socket.on('item:update', onItemUpdate as never);
}

/** Idempotent — safe on every connect / MapCanvas mount. */
export function bindWalkLiveIngress(socket: Socket): void {
  if (bound && bound !== socket) {
    unbindWalkLiveIngress(bound);
  }
  bound = socket;
  attachHandlers(socket);

  if (typeof BroadcastChannel !== 'undefined' && !bc) {
    bc = new BroadcastChannel('grimoire-walk-live');
    bc.onmessage = onBroadcast;
  }
}

export function unbindWalkLiveIngress(socket: Socket): void {
  socket.off('fp:pose', onFpPose as never);
  socket.off('token:live', onTokenLive as never);
  socket.off('token:rotate', onTokenRotate as never);
  socket.off('map:tokenMove', onMapTokenMove as never);
  socket.off('item:update', onItemUpdate as never);
  if (bound === socket) bound = null;
}

/** Same-origin tabs (GM + player windows) — bypasses socket room entirely. */
export function broadcastWalkLiveLocal(payload: {
  sessionId: string;
  tokenId: string;
  x: number;
  y: number;
  rotation: number;
}): void {
  if (typeof BroadcastChannel === 'undefined') return;
  if (!bc) {
    bc = new BroadcastChannel('grimoire-walk-live');
    bc.onmessage = onBroadcast;
  }
  bc.postMessage(payload);
}

/** Flush soft item write with latest walk (key release). */
export function flushWalkSoftCommit(tokenId: string): void {
  const walk = getWalkPose(tokenId);
  if (!walk) return;
  softWriteAt.set(tokenId, 0);
  softCommitItem(tokenId, walk.x, walk.y, walk.rotation);
}
