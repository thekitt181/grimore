/**
 * Mid-walk pose override. Stored on a naked globalThis table so no HMR/Proxy/Map
 * split can hide packets from the Three useFrame that paints remotes.
 */
export type WalkPose = { x: number; y: number; rotation?: number; at: number };

export const WALK_POSE_FRESH_MS = 2000;

type WalkRoot = { __grimoireWalkPoses?: Map<string, WalkPose> };

function table(): Map<string, WalkPose> {
  const root = globalThis as WalkRoot;
  if (!root.__grimoireWalkPoses) root.__grimoireWalkPoses = new Map();
  return root.__grimoireWalkPoses;
}

export function getWalkPose(tokenId: string): WalkPose | undefined {
  return table().get(tokenId);
}

export function isWalkPoseFresh(tokenId: string, now = performance.now()): boolean {
  const walk = table().get(tokenId);
  return Boolean(walk && now - walk.at < WALK_POSE_FRESH_MS);
}

export function setWalkPose(
  tokenId: string,
  x: number,
  y: number,
  rotation?: number,
): void {
  table().set(tokenId, {
    x,
    y,
    ...(rotation != null ? { rotation } : {}),
    at: performance.now(),
  });
}

export function clearWalkPose(tokenId: string): void {
  table().delete(tokenId);
}

export function walkPoseIds(): string[] {
  return [...table().keys()];
}

/** @deprecated */
export function ensureWalkPoseBridge(): void {}
