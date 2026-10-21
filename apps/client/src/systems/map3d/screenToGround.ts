import * as THREE from 'three';
import { isGm2dEditorInteraction, useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef } from './sceneCameraRef';
import { getMapPointerRect, pixiClientToWorld } from './pixiScreenCoords';
import { groundHeightAt } from './mapGroundRaycast';
import { syncOrthographicCamera } from './orthographicCameraSync';
import { syncPerspectiveCamera } from './perspectiveCameraSync';

const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
const planeNormal = new THREE.Vector3(0, 1, 0);
const planeAtY = new THREE.Plane();

function resolvePointerCamera(rect: DOMRect): THREE.Camera | null {
  const state = sceneCameraRef.current;
  if (!state) return null;
  const live = sceneCameraRef.liveCamera;
  if (live) {
    if (state.type === 'perspective' && live instanceof THREE.PerspectiveCamera) {
      live.updateMatrixWorld(true);
      return live;
    }
    if (state.type === 'orthographic' && live instanceof THREE.OrthographicCamera) {
      live.updateMatrixWorld(true);
      return live;
    }
  }
  const aspect = rect.width / Math.max(rect.height, 1);
  if (state.type === 'perspective') return syncPerspectiveCamera(state, aspect);
  return syncOrthographicCamera(state);
}

/**
 * Ray from the live 3D camera through the pointer onto a horizontal plane (Y-up).
 * Returns Pixi world x/y (= Three X/Z). Works for ortho orbit and perspective FP.
 *
 * Pass a fixed `planeY` during drags — re-sampling terrain height each move makes
 * XZ jump whenever the cursor crosses elevation (stairs, raised floors).
 */
export function clientPointerToGround(
  clientX: number,
  clientY: number,
  planeY?: number,
): { x: number; y: number } | null {
  const rect = getMapPointerRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;

  const camera = resolvePointerCamera(rect);
  if (!camera) return null;

  ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;

  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);

  if (planeY != null && Number.isFinite(planeY)) {
    planeAtY.set(planeNormal, -planeY);
    if (!raycaster.ray.intersectPlane(planeAtY, hitPoint)) return null;
    return { x: hitPoint.x, y: hitPoint.z };
  }

  // One-shot pick: flat ground, then refine onto local surface height once.
  const flat = raycaster.ray.intersectPlane(groundPlane, hitPoint);
  if (!flat) return null;

  let x = hitPoint.x;
  let z = hitPoint.z;
  const surfaceY = groundHeightAt(x, z, 0);
  if (Math.abs(surfaceY) > 0.5) {
    planeAtY.set(planeNormal, -surfaceY);
    if (raycaster.ray.intersectPlane(planeAtY, hitPoint)) {
      x = hitPoint.x;
      z = hitPoint.z;
    }
  }

  return { x, y: z };
}

/**
 * Authoritative pointer → map world for tools.
 * 3D: camera ray onto ground (token follows mouse at any orbit angle).
 * 2D / GM 2D editor pane: Pixi world transform.
 * @param planeY Lock the 3D ray to this height (use during continuous drag).
 */
export function pointerToMapWorld(
  clientX: number,
  clientY: number,
  planeY?: number,
): { x: number; y: number } {
  if (useMapStore.getState().viewMode === '3d' && !isGm2dEditorInteraction()) {
    const ground = clientPointerToGround(clientX, clientY, planeY);
    if (ground) return ground;
  }
  return pixiClientToWorld(clientX, clientY);
}
