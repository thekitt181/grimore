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

/** Fixed oblique view for 3D minis on the 2D map — like sitting at the table. */
export const TABLE_MINI_VIEW_POLAR = 0.55;
/** ~7° clockwise — mini front sits just right of camera center at 0° facing. */
export const TABLE_MINI_VIEW_AZIMUTH_OFFSET = 0.12;
export const TABLE_MINI_VIEW_AZIMUTH = Math.PI / 4.2 + TABLE_MINI_VIEW_AZIMUTH_OFFSET;

/** Build an OrthographicCamera matching a stored snapshot (picking fallback). */
export function syncOrthographicCamera(state: OrthographicCameraState): THREE.OrthographicCamera {
  orthoCam.left = state.left;
  orthoCam.right = state.right;
  orthoCam.top = state.top;
  orthoCam.bottom = state.bottom;
  orthoCam.near = 0.1;
  orthoCam.far = 8000;
  orthoCam.zoom = 1;
  orthoCam.position.set(state.position.x, state.position.y, state.position.z);
  orthoCam.up.set(0, 0, -1);
  orthoCam.lookAt(state.target.x, state.target.y, state.target.z);
  orthoCam.updateMatrixWorld();
  orthoCam.updateProjectionMatrix();
  return orthoCam;
}

/** Apply live Pixi pan/zoom to an orthographic camera. Orbit only in 3D view. */
export function applyOrthographicCameraFromViewport(
  camera: OrthographicCamera,
  fallbackW: number,
  fallbackH: number,
): void {
  const { w, h } = syncedCanvasSize(fallbackW, fallbackH);
  const { viewport, view3dOrbit, viewMode } = useMapStore.getState();
  const { cx, cz, scale: s } = viewportGroundCenter(viewport, w, h);
  const halfW = w / (2 * s);
  const halfH = h / (2 * s);

  let camX: number;
  let camY: number;
  let camZ: number;

  if (viewMode === '3d') {
    const sinP = Math.sin(view3dOrbit.polar);
    const cosP = Math.cos(view3dOrbit.polar);
    const sinA = Math.sin(view3dOrbit.azimuth);
    const cosA = Math.cos(view3dOrbit.azimuth);
    camX = cx + ORBIT_RADIUS * sinP * sinA;
    camY = ORBIT_RADIUS * cosP;
    camZ = cz + ORBIT_RADIUS * sinP * cosA;
  } else {
    // 2D map: tabletop view + manual mini orbit (right-drag when selected).
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
  camera.near = 0.1;
  camera.far = 8000;
  camera.position.set(camX, camY, camZ);
  camera.up.set(0, 0, -1);
  camera.lookAt(cx, 0, cz);
  camera.updateProjectionMatrix();

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
