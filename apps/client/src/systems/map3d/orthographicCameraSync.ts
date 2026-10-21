import type { OrthographicCamera } from 'three';
import * as THREE from 'three';
import type { OrthographicCameraState } from './sceneCameraRef';
import { sceneCameraRef } from './sceneCameraRef';
import { useMapStore } from '@/systems/map/store/mapStore';
import { viewportGroundCenter } from './viewportGroundCenter';
import { syncedCanvasSize } from './syncedCanvasSize';

const orthoCam = new THREE.OrthographicCamera();

/** Distance from ground center — matches legacy top-down height. */
const ORBIT_RADIUS = 1500;

/** Near/far slab for oblique ortho — widens when zoomed out so GLB terrain is not clipped. */
function orthographicDepthSlab(halfW: number, halfH: number): { near: number; far: number } {
  const viewSpan = Math.max(halfW, halfH, ORBIT_RADIUS * 0.35);
  const slab = ORBIT_RADIUS + viewSpan * 2.5;
  return { near: -slab, far: slab };
}

/**
 * True top-down in 2D — must match Pixi projection so 3D tokens + selection box stay locked
 * to the grid (any tilt skews Three vs Pixi and desyncs the gizmo).
 */
export const TABLE_MINI_VIEW_POLAR = 0.001;
/** Kept for token import yaw helpers; 2D camera azimuth is unused when polar ≈ 0. */
export const TABLE_MINI_VIEW_AZIMUTH_OFFSET = 0.12;
export const TABLE_MINI_VIEW_AZIMUTH = Math.PI / 4.2 + TABLE_MINI_VIEW_AZIMUTH_OFFSET;

/** Build an OrthographicCamera matching a stored snapshot (picking fallback). */
export function syncOrthographicCamera(state: OrthographicCameraState): THREE.OrthographicCamera {
  const halfW = (state.right - state.left) / 2;
  const halfH = (state.top - state.bottom) / 2;
  orthoCam.left = -halfW;
  orthoCam.right = halfW;
  orthoCam.top = halfH;
  orthoCam.bottom = -halfH;
  orthoCam.near = -ORBIT_RADIUS * 3;
  orthoCam.far = ORBIT_RADIUS * 3;
  orthoCam.zoom = 1;
  orthoCam.position.set(state.position.x, state.position.y, state.position.z);
  orthoCam.up.set(0, 0, -1);
  orthoCam.lookAt(state.target.x, state.target.y, state.target.z);
  orthoCam.updateMatrixWorld();
  orthoCam.updateProjectionMatrix();
  return orthoCam;
}

export type OrthoViewportProjection = 'auto' | 'topdown' | 'orbit';

export interface ApplyOrthoViewportOptions {
  /** Override viewMode-based projection. `topdown` = tabletop (2D / GM 2D editor). */
  projection?: OrthoViewportProjection;
  /** When false, do not overwrite the live pick camera (secondary display canvases). */
  bindSceneCamera?: boolean;
  /** Prefer this canvas size over Pixi screen (split-pane underlays). */
  useLocalSize?: boolean;
}

/** Apply live Pixi pan/zoom to an orthographic camera. Orbit only in 3D view. */
export function applyOrthographicCameraFromViewport(
  camera: OrthographicCamera,
  fallbackW: number,
  fallbackH: number,
  opts?: ApplyOrthoViewportOptions,
): void {
  const { w, h } = opts?.useLocalSize
    ? { w: fallbackW, h: fallbackH }
    : syncedCanvasSize(fallbackW, fallbackH);
  const { viewport, view3dOrbit, viewMode } = useMapStore.getState();

  const projection = opts?.projection ?? 'auto';
  const useOrbit =
    projection === 'orbit' || (projection === 'auto' && viewMode === '3d');

  // Always follow Pixi pan/zoom so the left 3D pane and right 2D editor stay aligned.
  // (Per-token orbit swaps are disabled separately while the editor is open.)
  const { cx, cz, scale: s } = viewportGroundCenter(viewport, w, h);
  const halfW = w / (2 * s);
  const halfH = h / (2 * s);

  let camX: number;
  let camY: number;
  let camZ: number;

  if (useOrbit) {
    const sinP = Math.sin(view3dOrbit.polar);
    const cosP = Math.cos(view3dOrbit.polar);
    const sinA = Math.sin(view3dOrbit.azimuth);
    const cosA = Math.cos(view3dOrbit.azimuth);
    camX = cx + ORBIT_RADIUS * sinP * sinA;
    camY = ORBIT_RADIUS * cosP;
    camZ = cz + ORBIT_RADIUS * sinP * cosA;
  } else {
    // 2D map / GM 2D editor: tabletop view + manual mini orbit (right-drag when selected).
    const { view2dMiniOrbit } = useMapStore.getState();
    const azimuth = TABLE_MINI_VIEW_AZIMUTH + view2dMiniOrbit.azimuth;
    const sinP = Math.sin(TABLE_MINI_VIEW_POLAR);
    const cosP = Math.cos(TABLE_MINI_VIEW_POLAR);
    const sinA = Math.sin(azimuth);
    const cosA = Math.cos(azimuth);
    camX = cx + ORBIT_RADIUS * sinP * sinA;
    camY = ORBIT_RADIUS * cosP;
    camZ = cz + ORBIT_RADIUS * sinP * cosA;
  }

  camera.zoom = 1;
  camera.left = -halfW;
  camera.right = halfW;
  camera.top = halfH;
  camera.bottom = -halfH;
  const depth = orthographicDepthSlab(halfW, halfH);
  camera.near = depth.near;
  camera.far = depth.far;
  camera.position.set(camX, camY, camZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(cx, 0, cz);
  camera.updateProjectionMatrix();

  if (opts?.bindSceneCamera === false) return;

  sceneCameraRef.liveCamera = camera;
  sceneCameraRef.current = {
    type: 'orthographic',
    left: cx - halfW,
    right: cx + halfW,
    top: cz + halfH,
    bottom: cz - halfH,
    position: { x: camX, y: camY, z: camZ },
    target: { x: cx, y: 0, z: cz },
  };
}
