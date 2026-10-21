import { useEffect } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { fpGlobal } from '@/systems/map3d/fpGlobals';
import { bindPoseRelay } from '@/systems/scene/token/poseRelay';
import { bindWalkLiveIngress } from '@/systems/scene/token/walkLiveIngress';
import { getSocket } from '@/lib/socket';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { getWalkPose, walkPoseIds, WALK_POSE_FRESH_MS } from '@/systems/scene/token/walkPoseBus';
import { registerPixiToken } from '@/systems/scene/token/remotePoseApply';
import { getDragLivePosition } from '@/systems/scene/interaction/dragLivePositions';
import { Container } from 'pixi.js';

/** Smooth chase toward live walk targets (matches Three WALK_LERP feel). */
const PIXI_WALK_LERP = 28;
const PIXI_SNAP_PX = 180;

type DisplayPose = { x: number; y: number; rot: number; primed: boolean };
const displayById = new Map<string, DisplayPose>();

function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}

function pixiFor(id: string) {
  const cached = fpGlobal.pixiById.get(id);
  if (cached) return cached;
  const label = `item_${id}`;
  const layer = sceneRefs.tokens.current ?? sceneRefs.items.current;
  if (!layer) return null;
  const found = layer.getChildByLabel(label) as Container | null;
  if (!found) return null;
  registerPixiToken(id, found);
  return found;
}

let lastAt = performance.now();

function chaseWalkPoses(): void {
  const items = useItemStore.getState().items;
  const now = performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastAt) / 1000));
  lastAt = now;

  const active = new Set(walkPoseIds());
  for (const id of active) {
    const walk = getWalkPose(id);
    if (!walk || now - walk.at > WALK_POSE_FRESH_MS) {
      displayById.delete(id);
      continue;
    }
    const item = items[id];
    if (!item || item.type !== 'token') continue;
    // Local drag owns the sprite — don't fight it.
    if (getDragLivePosition(id)) {
      displayById.delete(id);
      continue;
    }

    const c = pixiFor(id);
    if (!c) continue;

    const targetX = walk.x + item.width / 2;
    const targetY = walk.y + item.height / 2;
    const targetRot = ((walk.rotation ?? item.rotation ?? 0) * Math.PI) / 180;

    let d = displayById.get(id);
    if (!d) {
      d = { x: targetX, y: targetY, rot: targetRot, primed: false };
      displayById.set(id, d);
    }

    if (!d.primed || Math.hypot(targetX - d.x, targetY - d.y) > PIXI_SNAP_PX) {
      d.x = targetX;
      d.y = targetY;
      d.rot = targetRot;
      d.primed = true;
    } else {
      d.x = damp(d.x, targetX, PIXI_WALK_LERP, dt);
      d.y = damp(d.y, targetY, PIXI_WALK_LERP, dt);
      let dRot = targetRot - d.rot;
      while (dRot > Math.PI) dRot -= Math.PI * 2;
      while (dRot < -Math.PI) dRot += Math.PI * 2;
      d.rot = damp(d.rot, d.rot + dRot, PIXI_WALK_LERP, dt);
    }

    c.position.set(d.x, d.y);
    c.rotation = d.rot;
  }

  for (const id of [...displayById.keys()]) {
    if (!active.has(id)) displayById.delete(id);
  }
}

/**
 * Smooth Pixi tokens toward fresh walk poses every frame (ticker or rAF).
 */
export function useLiveTokenPixiSync(appReady: boolean): void {
  useEffect(() => {
    if (!appReady) return;
    const socket = getSocket();
    bindPoseRelay(socket);
    bindWalkLiveIngress(socket);
    lastAt = performance.now();

    const app = sceneRefs.app.current;
    if (app?.ticker) {
      app.ticker.add(chaseWalkPoses);
      return () => {
        app.ticker.remove(chaseWalkPoses);
        displayById.clear();
      };
    }

    let raf = 0;
    const loop = () => {
      chaseWalkPoses();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      displayById.clear();
    };
  }, [appReady]);
}
