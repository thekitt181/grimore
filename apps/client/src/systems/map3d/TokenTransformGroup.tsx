import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { getSocket } from '@/lib/socket';
import { bindPoseRelay } from '@/systems/scene/token/poseRelay';
import { registerRemotePoseGroup } from '@/systems/scene/token/remotePoseApply';
import { getWalkPose, WALK_POSE_FRESH_MS } from '@/systems/scene/token/walkPoseBus';
import { feetObjectName } from './fpFeetName';
import { useFirstPersonStore } from './firstPersonStore';
import { damp } from './firstPersonMotion';
import { degToRad } from './coords';
import { groundHeightAt } from './mapGroundRaycast';
import { bakedGroundHeightSmooth, getMapCollisionGrid } from './mapCollisionGrid';
import { resolveItemBounds } from './sceneItemBounds';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import type { ImageItem, Item, TokenItem } from '@/systems/scene/types';
import { firstPersonLook } from './firstPersonLook';
import { poseForToken } from './firstPersonPose';

bindPoseRelay(getSocket());

const TOKEN_SURFACE_PAD = 0.12;
/** Short props (chests etc.) sink under map floors with the tiny token pad — keep them on top. */
const PROP_SURFACE_PAD = 2.4;
/**
 * GM 2D editor underlay: lift minis above dense GLB map meshes so they aren't
 * buried when the camera looks straight down.
 */
const DISPLAY_ONLY_LIFT = 48;
/** Settle speed when not streaming walk (commit / idle). */
const REMOTE_LERP = 90;
/** Chase live walk packets — high enough to feel realtime, low enough to hide jitter. */
const WALK_LERP = 28;
/** Snap if the remote jumped farther than this (teleport / hydrate). */
const WALK_SNAP_PX = 180;

export function SceneItemTransformGroup({
  itemId,
  surfaceY = 0,
  /** Extra lift on top of ground (wall-mounted props: torch height, etc.). */
  wallLift = 0,
  baseWidth,
  baseHeight,
  scaleBaseWidth,
  scaleBaseHeight,
  /** Preview canvas (GM 2D editor underlay) — don't steal live pose / feet registration. */
  displayOnly = false,
  children,
}: {
  itemId: string;
  surfaceY?: number | 'ground';
  wallLift?: number;
  baseWidth?: number;
  baseHeight?: number;
  scaleBaseWidth?: number;
  scaleBaseHeight?: number;
  displayOnly?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<Group>(null);
  const smooth = useRef<{ x: number; z: number; yaw: number; primed: boolean }>({
    x: 0,
    z: 0,
    yaw: 0,
    primed: false,
  });
  /** Last good ground Y — avoids falling through mesh holes while dragging props. */
  const lastGroundY = useRef<number | null>(null);

  useEffect(() => {
    if (displayOnly) return;
    registerRemotePoseGroup(itemId, ref.current as never);
    return () => registerRemotePoseGroup(itemId, null);
  }, [itemId, displayOnly]);

  // Priority 0: run with (after) default subscribers so mixer root-motion is pinned same frame.
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    if (!displayOnly) registerRemotePoseGroup(itemId, g as never);

    const item = useItemStore.getState().items[itemId];
    if (!item) return;

    const live = useLiveTransformStore.getState().byId[itemId];
    const b = resolveItemBounds(item as Item, live);
    const fp = useFirstPersonStore.getState();
    const localFpDriver = item.type === 'token' && fp.enabled && fp.tokenId === itemId;
    const frameDt = Math.min(0.05, Math.max(0, dt));
    const s = smooth.current;

    const walk = item.type === 'token' ? getWalkPose(itemId) : undefined;
    const walkFresh = Boolean(walk && performance.now() - walk.at < WALK_POSE_FRESH_MS);
    // Own body in FP: still snap to walk/pose so the mini isn't left behind the camera.
    const useWalk = Boolean(walkFresh && walk && item.type === 'token');

    let cx = b.cx;
    let cz = b.cz;
    let spinY = item.type === 'token' ? -degToRad(b.rotation) : degToRad(b.rotation);

    if (useWalk && walk) {
      const targetCx = walk.x + item.width / 2;
      const targetCz = walk.y + item.height / 2;
      const targetYaw = -degToRad(walk.rotation ?? item.rotation ?? 0);
      // Local FP body: snap so the mini stays under the camera.
      // Remotes: smooth chase so packets look seamless.
      if (
        localFpDriver
        || !s.primed
        || Math.hypot(targetCx - s.x, targetCz - s.z) > WALK_SNAP_PX
      ) {
        s.x = targetCx;
        s.z = targetCz;
        s.yaw = targetYaw;
        s.primed = true;
      } else {
        s.x = damp(s.x, targetCx, WALK_LERP, frameDt);
        s.z = damp(s.z, targetCz, WALK_LERP, frameDt);
        let dyaw = targetYaw - s.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        s.yaw = damp(s.yaw, s.yaw + dyaw, WALK_LERP, frameDt);
      }
      cx = s.x;
      cz = s.z;
      spinY = s.yaw;
    } else if (
      item.type === 'token'
      && !localFpDriver
      && live
      && (live.x != null || live.y != null)
    ) {
      // Live store without walk bus — smooth chase (same feel as walk).
      const targetCx = b.cx;
      const targetCz = b.cz;
      const targetYaw = -degToRad(b.rotation);
      if (!s.primed || Math.hypot(targetCx - s.x, targetCz - s.z) > WALK_SNAP_PX) {
        s.x = targetCx;
        s.z = targetCz;
        s.yaw = targetYaw;
        s.primed = true;
      } else {
        s.x = damp(s.x, targetCx, WALK_LERP, frameDt);
        s.z = damp(s.z, targetCz, WALK_LERP, frameDt);
        let dyaw = targetYaw - s.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        s.yaw = damp(s.yaw, s.yaw + dyaw, WALK_LERP, frameDt);
      }
      cx = s.x;
      cz = s.z;
      spinY = s.yaw;
    } else if (item.type === 'token' && localFpDriver) {
      const pose = poseForToken(item as TokenItem);
      cx = pose.x + item.width / 2;
      cz = pose.y + item.height / 2;
      spinY = -degToRad(firstPersonLook.yaw);
      s.x = cx;
      s.z = cz;
      s.yaw = spinY;
      s.primed = true;
    } else if (item.type === 'token' && !localFpDriver) {
      if (!s.primed) {
        s.x = cx;
        s.z = cz;
        s.yaw = spinY;
        s.primed = true;
      } else {
        s.x = damp(s.x, cx, REMOTE_LERP, frameDt);
        s.z = damp(s.z, cz, REMOTE_LERP, frameDt);
        let dyaw = spinY - s.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        s.yaw = damp(s.yaw, s.yaw + dyaw, REMOTE_LERP, frameDt);
      }
      cx = s.x;
      cz = s.z;
      spinY = s.yaw;
    } else {
      s.primed = false;
    }

    let yBase: number;
    if (surfaceY === 'ground') {
      const pad = item.type === 'image' ? PROP_SURFACE_PAD : TOKEN_SURFACE_PAD;
      const fallback = lastGroundY.current ?? 0;
      // Skip mesh ground rays while: local FP is on, this token has a fresh walk pose,
      // or display-only underlay. Rays on dense GLBs hitch look/walk and starve socket apply.
      // Still take one sample if we have no prior height so minis don't spawn at Y=0.
      // Prefer baked height (O(1), stair-aware). Skip live mesh rays while FP / mid-walk.
      const activeMap = getActiveMap();
      const hasBake = Boolean(activeMap && getMapCollisionGrid(activeMap.id)?.ready);
      const skipMeshRay = displayOnly
        || ((fp.enabled || useWalk) && (hasBake || lastGroundY.current != null));
      let sampled = fallback;
      if (hasBake && activeMap) {
        sampled = bakedGroundHeightSmooth(activeMap.id, cx, cz, fallback);
      } else if (!skipMeshRay) {
        sampled = groundHeightAt(cx, cz, fallback);
      }
      // Ignore wild spikes/drops from thin decor hits while dragging (props especially).
      if (
        !displayOnly
        && lastGroundY.current != null
        && item.type === 'image'
        && Math.abs(sampled - lastGroundY.current) > 80
      ) {
        yBase = lastGroundY.current + pad;
      } else {
        lastGroundY.current = sampled;
        yBase = sampled + pad;
      }
      if (displayOnly && item.type === 'token') {
        yBase += DISPLAY_ONLY_LIFT;
      }
      if (wallLift !== 0) yBase += wallLift;
    } else {
      yBase = surfaceY + wallLift;
    }

    const sx = scaleBaseWidth ?? baseWidth;
    const sz = scaleBaseHeight ?? baseHeight;
    let nextSx = 1;
    let nextSz = 1;
    if (sx != null && sz != null && sx > 0 && sz > 0) {
      nextSx = b.width / sx;
      nextSz = b.height / sz;
    }

    // Hide the local FP body — camera sits at eye height inside the mesh otherwise.
    // Remotes still see the mini + walk anim. Display-only underlay stays visible.
    const nextVisible = displayOnly || !(localFpDriver && item.type === 'token');

    // Props: optional 3D pitch/roll (wall mount — tip top sideways / any angle).
    let pitch = 0;
    let roll = 0;
    if (item.type === 'image') {
      const img = item as ImageItem;
      pitch = degToRad(img.propPitch ?? 0);
      roll = degToRad(img.propRoll ?? 0);
    }

    // Dense GLB maps: updateMatrixWorld(true) every frame was the dungeon-vs-model jank.
    // Skip the whole write when nothing moved (static maps stay idle after first frame).
    const unchanged =
      Math.abs(g.position.x - cx) < 1e-3
      && Math.abs(g.position.y - yBase) < 1e-3
      && Math.abs(g.position.z - cz) < 1e-3
      && Math.abs(g.rotation.x - pitch) < 1e-4
      && Math.abs(g.rotation.y - spinY) < 1e-4
      && Math.abs(g.rotation.z - roll) < 1e-4
      && Math.abs(g.scale.x - nextSx) < 1e-4
      && Math.abs(g.scale.z - nextSz) < 1e-4
      && g.visible === nextVisible;
    if (unchanged) return;

    g.scale.set(nextSx, 1, nextSz);
    g.position.set(cx, yBase, cz);
    g.rotation.set(pitch, spinY, roll);
    g.visible = nextVisible;

    // Tokens need an immediate world matrix for foot-plant; maps/props can wait for render.
    if (item.type === 'token') {
      g.updateMatrixWorld(true);
    } else {
      g.matrixWorldNeedsUpdate = true;
    }
  }, 0);

  return (
    <group ref={ref} {...(displayOnly ? {} : { name: feetObjectName(itemId) })}>
      {children}
    </group>
  );
}

/** @deprecated use SceneItemTransformGroup */
export const TokenTransformGroup = SceneItemTransformGroup;
