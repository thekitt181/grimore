/**
 * Apply remote FP / rotate pose. Walk feet live on globalThis.__grimoireWalkPoses.
 * Three: prefer scene-graph object by name (never a stale Map ref).
 */
import { Container } from 'pixi.js';
import type { Object3D, Scene } from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { setWalkPose } from '@/systems/scene/token/walkPoseBus';
import { fpGlobal, type FpWalkStamp, type RemoteThreeGroup } from '@/systems/map3d/fpGlobals';
import { feetObjectName } from '@/systems/map3d/fpFeetName';
import { sceneRefs } from '@/systems/scene/sceneRefs';

const STAMP_KEY = '__fpWalk';
let applyLog = 0;

type PixiTok = {
  position: { set: (x: number, y: number) => void };
  rotation: number;
  __fpWalk?: FpWalkStamp;
};

function resolvePixiContainer(tokenId: string): PixiTok | null {
  const cached = fpGlobal.pixiById.get(tokenId);
  if (cached) return cached;

  const label = `item_${tokenId}`;
  const fromLayer = (layer: Container | null) => {
    if (!layer) return null;
    return (layer.getChildByLabel(label) as Container | null) ?? null;
  };
  const found =
    fromLayer(sceneRefs.tokens.current as Container | null)
    ?? fromLayer(sceneRefs.items.current as Container | null);
  if (!found) return null;
  fpGlobal.pixiById.set(tokenId, found);
  return found;
}

function resolveThreeGroup(tokenId: string): RemoteThreeGroup | null {
  const scene = fpGlobal.threeScene as Scene | null | undefined;
  if (scene) {
    const named = scene.getObjectByName(feetObjectName(tokenId)) as Object3D | undefined;
    if (named) {
      const g = named as unknown as RemoteThreeGroup;
      if (!g.userData) g.userData = {};
      fpGlobal.threeGroups.set(tokenId, g);
      return g;
    }
  }
  return fpGlobal.threeGroups.get(tokenId) ?? null;
}

export function registerThreeScene(scene: Scene | null): void {
  fpGlobal.threeScene = scene;
}

export function registerRemotePoseGroup(tokenId: string, group: RemoteThreeGroup | null): void {
  if (!group) {
    fpGlobal.threeGroups.delete(tokenId);
    return;
  }
  if (!group.userData) group.userData = {};
  fpGlobal.threeGroups.set(tokenId, group);
}

export function registerPixiToken(tokenId: string, container: PixiTok | null): void {
  if (!container) {
    fpGlobal.pixiById.delete(tokenId);
    return;
  }
  fpGlobal.pixiById.set(tokenId, container);
}

export function readThreeWalkStamp(group: { userData?: Record<string, unknown> }): FpWalkStamp | undefined {
  const s = group.userData?.[STAMP_KEY];
  return s && typeof s === 'object' ? (s as FpWalkStamp) : undefined;
}

export function isStampFresh(stamp: FpWalkStamp | undefined, ms = 2000): boolean {
  return Boolean(stamp && performance.now() - stamp.at < ms);
}

/**
 * Stamp the walk bus only — Three/Pixi chase this target every frame so remotes
 * look smooth instead of snapping on each packet.
 */
/** Walk bus + Pixi/Three chase targets (local FP driver and remotes). */
export function applyWalkPoseVisual(
  tokenId: string,
  x: number,
  y: number,
  rotation?: number,
): void {
  setWalkPose(tokenId, x, y, rotation);

  const item = useItemStore.getState().items[tokenId];
  if (!item || item.type !== 'token') return;

  const rotDeg = rotation ?? item.rotation ?? 0;
  const stamp: FpWalkStamp = { x, y, rotation: rotDeg, at: performance.now() };

  const g = resolveThreeGroup(tokenId);
  if (g) g.userData[STAMP_KEY] = stamp;

  const c = resolvePixiContainer(tokenId);
  if (c) c.__fpWalk = stamp;

  applyLog += 1;
  if (applyLog === 1 || applyLog % 40 === 0) {
    console.info(
      '[FP walk] target',
      applyLog,
      `xy=${x.toFixed(0)},${y.toFixed(0)}`,
      `three=${g ? 'Y' : 'N'}`,
      `pixi=${c ? 'Y' : 'N'}`,
    );
  }
}

export function applyRemoteWalkPose(
  tokenId: string,
  x: number,
  y: number,
  rotation?: number,
): void {
  applyWalkPoseVisual(tokenId, x, y, rotation);
}
