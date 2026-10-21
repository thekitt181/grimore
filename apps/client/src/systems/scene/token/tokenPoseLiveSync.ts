import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemUpdateLive } from '@/systems/scene/sceneSync';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { worldToGridColRow } from '@/systems/scene/token/tokenGrid';
import { applyWalkPoseVisual } from '@/systems/scene/token/remotePoseApply';
import { setWalkPose } from '@/systems/scene/token/walkPoseBus';
import { broadcastWalkLiveLocal } from '@/systems/scene/token/walkLiveIngress';

/** ~60 Hz — smoother remote drag / orbit follow without flooding the socket. */
const INTERVAL_MS = 16;
let lastEmitAt = 0;

/**
 * Stream token feet mid-drag / mid-walk so anyone who can see the token
 * follows in realtime (same channels as FP walk).
 */
export function emitTokenPoseLive(
  patches: Array<{ id: string; x: number; y: number; rotation?: number }>,
): void {
  if (!patches.length) return;
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;

  const items = useItemStore.getState().items;
  const livePatches: Array<{ id: string; patch: Record<string, number> }> = [];

  for (const p of patches) {
    const token = items[p.id];
    if (!token || token.type !== 'token') continue;

    const rotation = p.rotation ?? token.rotation ?? 0;
    // Local visuals every pointer move — Three/Pixi must not wait on the ~30 Hz socket throttle.
    setWalkPose(p.id, p.x, p.y, rotation);
    applyWalkPoseVisual(p.id, p.x, p.y, rotation);

    const cx = p.x + token.width / 2;
    const cy = p.y + token.height / 2;
    const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);

    livePatches.push({
      id: p.id,
      patch: { x: p.x, y: p.y, rotation, gridCol, gridRow },
    });
  }

  const now = performance.now();
  if (now - lastEmitAt < INTERVAL_MS) return;
  lastEmitAt = now;

  for (const entry of livePatches) {
    const { x, y, rotation, gridCol, gridRow } = entry.patch;
    if (
      typeof x !== 'number'
      || typeof y !== 'number'
      || typeof rotation !== 'number'
      || typeof gridCol !== 'number'
      || typeof gridRow !== 'number'
    ) {
      continue;
    }
    const pose = {
      sessionId,
      tokenId: entry.id,
      x,
      y,
      rotation,
      gridCol,
      gridRow,
    };
    broadcastWalkLiveLocal(pose);

    const socket = getSocket();
    if (socket.connected) {
      socket.emit('token:live', pose);
      socket.emit('fp:pose', pose);
    }
  }

  if (livePatches.length) {
    emitItemUpdateLive(livePatches as never);
  }
}
