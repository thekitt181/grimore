import type { TokenItem } from '@/systems/scene/types';
import { floorStandRank, mapUnderTokenFeet } from '@/systems/scene/hitTest';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { applyWalkPoseVisual } from '@/systems/scene/token/remotePoseApply';
import { firstPersonLook } from './firstPersonLook';
import { firstPersonMotion } from './firstPersonMotion';
import { fpGlobal, type FpPoseState } from './fpGlobals';

/** Always resolve through globalThis — never capture pose at module load. */
export const firstPersonPose: FpPoseState = new Proxy({} as FpPoseState, {
  get(_t, prop, _r) {
    return Reflect.get(fpGlobal.pose, prop, fpGlobal.pose);
  },
  set(_t, prop, value) {
    return Reflect.set(fpGlobal.pose, prop, value);
  },
  has(_t, prop) {
    return Reflect.has(fpGlobal.pose, prop);
  },
});

export function clearFirstPersonPose(): void {
  firstPersonPose.active = false;
  firstPersonPose.tokenId = null;
}

function feetRank(token: TokenItem, x: number, y: number): number {
  const floor = mapUnderTokenFeet(x + token.width / 2, y + token.height / 2);
  return floor ? floorStandRank(floor) : 0;
}

export function seedFirstPersonPose(token: TokenItem): void {
  const live = useLiveTransformStore.getState().byId[token.id];
  const itemX = token.x;
  const itemY = token.y;
  const liveX = live?.x ?? itemX;
  const liveY = live?.y ?? itemY;
  const itemRank = feetRank(token, itemX, itemY);
  const liveRank = feetRank(token, liveX, liveY);
  // Committed item.x wins ties — leftover live at a doorway tile must not win.
  const x = liveRank > itemRank ? liveX : itemX;
  const y = liveRank > itemRank ? liveY : itemY;
  firstPersonPose.active = true;
  firstPersonPose.tokenId = token.id;
  firstPersonPose.x = x;
  firstPersonPose.y = y;
  firstPersonPose.prevX = x;
  firstPersonPose.prevY = y;
  const floor = mapUnderTokenFeet(x + token.width / 2, y + token.height / 2);
  if (floor) useItemStore.getState().setActiveMap(floor.id);
}

/** Call once at the start of each render frame (before integrating movement). */
export function snapshotFirstPersonPose(): void {
  firstPersonPose.prevX = firstPersonPose.x;
  firstPersonPose.prevY = firstPersonPose.y;
}

/** Feet for render + token mini (after full frame integration). */
export function firstPersonFeetForRender(): { x: number; y: number } {
  return { x: firstPersonPose.x, y: firstPersonPose.y };
}

/** Render feet position between physics ticks. */
export function interpolatedFirstPersonPose(alpha: number): { x: number; y: number } {
  const a = Math.min(1, Math.max(0, alpha));
  return {
    x: firstPersonPose.prevX + (firstPersonPose.x - firstPersonPose.prevX) * a,
    y: firstPersonPose.prevY + (firstPersonPose.y - firstPersonPose.prevY) * a,
  };
}

export function poseForToken(token: TokenItem): { x: number; y: number } {
  if (firstPersonPose.active && firstPersonPose.tokenId === token.id) {
    return { x: firstPersonPose.x, y: firstPersonPose.y };
  }
  const live = useLiveTransformStore.getState().byId[token.id];
  return { x: live?.x ?? token.x, y: live?.y ?? token.y };
}

function fpMoveKeysHeld(): boolean {
  const k = firstPersonMotion.held;
  return k.has('w') || k.has('a') || k.has('s') || k.has('d')
    || k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright');
}

/**
 * After a 2D drag / grid snap, pull FP feet to the authoritative token position
 * (only when not mid-WASD — avoids fighting the local driver).
 * Uses item store only — stale liveTransform after walk caused snap-back on stop.
 */
export function syncFirstPersonPoseFromItem(token: TokenItem, thresholdPx = 2): boolean {
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) return false;
  if (fpGlobal.walkStreaming || fpMoveKeysHeld()) return false;
  const base = useItemStore.getState().items[token.id];
  if (!base || base.type !== 'token') return false;
  const x = base.x;
  const y = base.y;
  const dist = Math.hypot(x - firstPersonPose.x, y - firstPersonPose.y);
  if (dist < thresholdPx) return false;
  // Stale item.x on a leftover 2 m tile must not yank the camera across the dungeon.
  const cell = Math.max(24, token.width, token.height);
  if (dist > cell * 2) return false;
  firstPersonPose.x = x;
  firstPersonPose.y = y;
  firstPersonPose.prevX = x;
  firstPersonPose.prevY = y;
  applyWalkPoseVisual(token.id, x, y, firstPersonLook.yaw);
  return true;
}
