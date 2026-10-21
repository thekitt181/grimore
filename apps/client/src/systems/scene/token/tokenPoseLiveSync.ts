import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemUpdateLive } from '@/systems/scene/sceneSync';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { worldToGridColRow } from '@/systems/scene/token/tokenGrid';
import { setWalkPose } from '@/systems/scene/token/walkPoseBus';
import { broadcastWalkLiveLocal } from '@/systems/scene/token/walkLiveIngress';

/** ~30 Hz — smooth for remotes without flooding the socket. */
const INTERVAL_MS = 33;
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

  const now = performance.now();
  if (now - lastEmitAt < INTERVAL_MS) return;
  lastEmitAt = now;

  const items = useItemStore.getState().items;
  const livePatches: Array<{ id: string; patch: Record<string, number> }> = [];

  for (const p of patches) {
    const token = items[p.id];
    if (!token || token.type !== 'token') continue;

    const rotation = p.rotation ?? token.rotation ?? 0;
    setWalkPose(p.id, p.x, p.y, rotation);

    const cx = p.x + token.width / 2;
    const cy = p.y + token.height / 2;
    const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);

    livePatches.push({
      id: p.id,
      patch: { x: p.x, y: p.y, rotation, gridCol, gridRow },
    });

    const pose = {
      sessionId,
      tokenId: p.id,
      x: p.x,
      y: p.y,
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
