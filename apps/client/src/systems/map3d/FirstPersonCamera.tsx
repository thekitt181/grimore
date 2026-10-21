import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import type { TokenItem } from '@/systems/scene/types';
import { sceneCameraRef } from './sceneCameraRef';
import { pixiToThreeX, pixiToThreeZ } from './coords';
import { firstPersonLook } from './firstPersonLook';
import {
  firstPersonPose,
  interpolatedFirstPersonPose,
  seedFirstPersonPose,
  snapshotFirstPersonPose,
  syncFirstPersonPoseFromItem,
} from './firstPersonPose';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import {
  initiativeMoveLimitFt,
  probeFirstPersonStairs,
  publishFirstPersonLiveLocal,
  yawForwardWorld,
} from './firstPersonMove';
import { controlFirstPersonMove } from './firstPersonController';
import { damp, firstPersonMotion, FP_SIM_STEP } from './firstPersonMotion';
import {
  flushFpPosePersist,
  startFpPosePublisher,
  stopFpPosePublisher,
  tickFpPoseNetwork,
} from './fpPoseSync';
import { setMapRaycastPaused } from './mapGroundRaycast';
import { bakedGroundHeightSmooth, getMapCollisionGrid } from './mapCollisionGrid';
import { useTokenDragMeasureStore } from '@/systems/scene/interaction/tokenDragMeasureStore';

const EYE_CELLS = 1.1;
/** Eye height eases on stairs; flat floor snaps. */
const EYE_FOLLOW = 18;
const EYE_SNAP_DELTA = 0.28;
/** Soften baked height samples before eye follow (stairs / grid seams). */
const GROUND_FOLLOW = 26;
const GROUND_SNAP = 48;
/** ~¼ slower than the prior 3.25 cells/s walk. */
const WALK_CELLS_PER_SEC = 2.44;
/** Single-layer accel only (~0.17s) — local FP feel, no cam lag / wish stack. */
const WALK_ACCEL = 12;
/** Short stop (~0.12s). */
const WALK_STOP = 18;
const STOP_EPS = 1.8;
const MEASURE_MS = 280;
const STAIR_MS = 400;
const MAX_FRAME_DT = 0.05;
const MAX_WALK_SUBSTEPS = 12;

function integrateWalk(token: TokenItem, dt: number): void {
  const keys = firstPersonMotion.held;
  let mx = 0;
  let my = 0;
  if (keys.has('w') || keys.has('arrowup')) my -= 1;
  if (keys.has('s') || keys.has('arrowdown')) my += 1;
  if (keys.has('a') || keys.has('arrowleft')) mx -= 1;
  if (keys.has('d') || keys.has('arrowright')) mx += 1;

  const grid = getActiveMap()?.gridSize ?? 96;
  const maxSpeed = grid * WALK_CELLS_PER_SEC;
  const yaw = firstPersonLook.yaw;
  const { x: fx, y: fy } = yawForwardWorld(yaw);
  const rx = -fy;
  const ry = fx;

  let wishX = 0;
  let wishY = 0;
  const hasWish = mx !== 0 || my !== 0;
  if (hasWish) {
    wishX = fx * -my + rx * mx;
    wishY = fy * -my + ry * mx;
    const wLen = Math.hypot(wishX, wishY) || 1;
    wishX = (wishX / wLen) * maxSpeed;
    wishY = (wishY / wLen) * maxSpeed;
  }

  const motion = firstPersonMotion;
  if (!hasWish) {
    motion.velX = damp(motion.velX, 0, WALK_STOP, dt);
    motion.velY = damp(motion.velY, 0, WALK_STOP, dt);
    if (Math.hypot(motion.velX, motion.velY) < STOP_EPS) {
      motion.velX = 0;
      motion.velY = 0;
      return;
    }
  } else {
    motion.velX = damp(motion.velX, wishX, WALK_ACCEL, dt);
    motion.velY = damp(motion.velY, wishY, WALK_ACCEL, dt);
  }

  if (Math.hypot(motion.velX, motion.velY) < 0.4) return;

  const slid = controlFirstPersonMove(token, motion.velX, motion.velY, dt);
  motion.velX = slid.velX;
  motion.velY = slid.velY;
}

export function FirstPersonCamera() {
  const { set, size, get } = useThree();
  const lastAspect = useRef(0);
  const lastMeasure = useRef(0);
  const lastStair = useRef(0);
  const camera = useMemo(() => {
    const cam = new THREE.PerspectiveCamera(72, 1, 0.12, 8000);
    cam.up.set(0, 1, 0);
    cam.rotation.order = 'YXZ';
    return cam;
  }, []);

  // Only depend on `camera` — R3F `get`/`set` identities can churn and were
  // re-running this effect mid-walk (stopFpPosePublisher → token:move → remote freeze).
  useEffect(() => {
    const prevCamera = get().camera;
    camera.updateProjectionMatrix();
    set({ camera });
    const token = resolveFirstPersonToken();
    if (token) seedFirstPersonPose(token);
    const grid = getActiveMap()?.gridSize ?? 96;
    // Fixed eye — no per-frame ground rays (those hitch look on dense GLBs).
    firstPersonMotion.groundY = 0;
    firstPersonMotion.eyeY = grid * EYE_CELLS;
    firstPersonMotion.accum = 0;
    setMapRaycastPaused(true);
    startFpPosePublisher();
    return () => {
      // Don't flush mid-walk on Strict Mode / camera remount — FP exit owns stop.
      if (!useFirstPersonStore.getState().enabled) {
        stopFpPosePublisher();
      }
      setMapRaycastPaused(false);
      sceneCameraRef.liveCamera = null;
      if (prevCamera && prevCamera !== camera) set({ camera: prevCamera });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- get/set must stay out of deps
  }, [camera]);

  useFrame((_, dt) => {
    const token = resolveFirstPersonToken();
    if (!token) return;
    if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) {
      seedFirstPersonPose(token);
    }
    const map = getActiveMap();
    const grid = map?.gridSize ?? 96;
    const now = performance.now();

    // Fixed-step physics + render interpolation (camera only — sync still uses real feet).
    const frameDt = Math.min(MAX_FRAME_DT, Math.max(0, dt));
    const motion = firstPersonMotion;
    motion.accum = Math.min(motion.accum + frameDt, FP_SIM_STEP * MAX_WALK_SUBSTEPS);
    let steps = 0;
    while (motion.accum >= FP_SIM_STEP && steps < MAX_WALK_SUBSTEPS) {
      snapshotFirstPersonPose();
      integrateWalk(token, FP_SIM_STEP);
      motion.accum -= FP_SIM_STEP;
      steps += 1;
    }
    const renderAlpha = motion.accum / FP_SIM_STEP;

    const keys = firstPersonMotion.held;
    const keysDown = keys.has('w') || keys.has('a') || keys.has('s') || keys.has('d')
      || keys.has('arrowup') || keys.has('arrowdown') || keys.has('arrowleft') || keys.has('arrowright');
    const speed = Math.hypot(firstPersonMotion.velX, firstPersonMotion.velY);
    const moving = keysDown || speed > 0.5;
    if (moving) {
      publishFirstPersonLiveLocal(token);
      tickFpPoseNetwork(token, true);
    } else {
      // Soft-stop finished after key release — commit once (no hard zero on keyup).
      if (!keysDown) flushFpPosePersist();
      syncFirstPersonPoseFromItem(token);
    }

    if (now - lastStair.current >= STAIR_MS) {
      lastStair.current = now;
      probeFirstPersonStairs(token);
    }
    if (now - lastMeasure.current >= MEASURE_MS) {
      lastMeasure.current = now;
      const remaining = initiativeMoveLimitFt(token.id);
      const used = useFirstPersonStore.getState().feetUsed(token.id);
      useTokenDragMeasureStore.getState().setMeasure(
        remaining === null ? used : remaining,
        window.innerWidth / 2,
        window.innerHeight - 72,
      );
    }

    const live = useLiveTransformStore.getState().byId[token.id];
    const w = live?.width ?? token.width;
    const h = live?.height ?? token.height;
    let feetX: number;
    let feetY: number;
    if (firstPersonPose.active && firstPersonPose.tokenId === token.id) {
      const drawn = interpolatedFirstPersonPose(renderAlpha);
      feetX = drawn.x;
      feetY = drawn.y;
    } else {
      feetX = live?.x ?? token.x;
      feetY = live?.y ?? token.y;
    }

    const cx = pixiToThreeX(feetX + w / 2);
    const cz = pixiToThreeZ(feetY + h / 2);

    const { yaw, pitch } = firstPersonLook;
    const { x: fx, y: fz } = yawForwardWorld(yaw);

    // Follow baked floor so stairs raise the camera (no mid-stride mesh rays).
    const eyeOffset = grid * EYE_CELLS;
    let groundSample = firstPersonMotion.groundY;
    if (map && getMapCollisionGrid(map.id)?.ready) {
      groundSample = bakedGroundHeightSmooth(map.id, cx, cz, groundSample);
    }
    if (!Number.isFinite(firstPersonMotion.groundY)) {
      firstPersonMotion.groundY = groundSample;
    } else if (Math.abs(groundSample - firstPersonMotion.groundY) > GROUND_SNAP) {
      firstPersonMotion.groundY = groundSample;
    } else {
      firstPersonMotion.groundY = damp(
        firstPersonMotion.groundY,
        groundSample,
        GROUND_FOLLOW,
        frameDt,
      );
    }
    const targetEye = firstPersonMotion.groundY + eyeOffset;
    if (!Number.isFinite(firstPersonMotion.eyeY)) {
      firstPersonMotion.eyeY = targetEye;
    } else if (Math.abs(targetEye - firstPersonMotion.eyeY) < EYE_SNAP_DELTA) {
      firstPersonMotion.eyeY = targetEye;
    } else {
      firstPersonMotion.eyeY = damp(firstPersonMotion.eyeY, targetEye, EYE_FOLLOW, frameDt);
    }
    const eyeY = firstPersonMotion.eyeY;

    const aspect = size.width / Math.max(1, size.height);
    if (Math.abs(aspect - lastAspect.current) > 1e-4) {
      lastAspect.current = aspect;
      camera.aspect = aspect;
      camera.near = 0.12;
      camera.far = Math.max(4000, grid * 80);
      camera.updateProjectionMatrix();
    }

    camera.position.set(cx, eyeY, cz);
    camera.rotation.y = -((yaw * Math.PI) / 180);
    camera.rotation.x = pitch;
    camera.rotation.z = 0;

    const lookDist = grid * 4;
    const lookY = eyeY + Math.sin(pitch) * lookDist;
    const flat = Math.cos(pitch) * lookDist;
    const targetX = cx + fx * flat;
    const targetZ = cz + fz * flat;

    sceneCameraRef.liveCamera = camera;
    const ref = sceneCameraRef.current;
    if (ref && ref.type === 'perspective') {
      ref.position.x = camera.position.x;
      ref.position.y = camera.position.y;
      ref.position.z = camera.position.z;
      ref.target.x = targetX;
      ref.target.y = lookY;
      ref.target.z = targetZ;
      ref.fov = camera.fov;
      ref.near = camera.near;
      ref.far = camera.far;
    } else {
      sceneCameraRef.current = {
        type: 'perspective',
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        target: { x: targetX, y: lookY, z: targetZ },
        fov: camera.fov,
        near: camera.near,
        far: camera.far,
      };
    }
  }, -100);

  return null;
}
