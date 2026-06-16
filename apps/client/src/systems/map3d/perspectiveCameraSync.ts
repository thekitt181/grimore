import * as THREE from 'three';
import type { PerspectiveCameraState } from './sceneCameraRef';
import { sceneCameraRef } from './sceneCameraRef';
import { syncOrthographicCamera } from './orthographicCameraSync';

const perspCam = new THREE.PerspectiveCamera();
const worldVec = new THREE.Vector3();

function ndcToClient(rect: DOMRect): { x: number; y: number } {
  return {
    x: rect.left + (worldVec.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-worldVec.y * 0.5 + 0.5) * rect.height,
  };
}

/** Build a PerspectiveCamera matching the live 3D orbit snapshot. */
export function syncPerspectiveCamera(
  cam: PerspectiveCameraState,
  aspect: number,
): THREE.PerspectiveCamera {
  perspCam.fov = cam.fov;
  perspCam.aspect = aspect;
  perspCam.near = cam.near;
  perspCam.far = cam.far;
  perspCam.position.set(cam.position.x, cam.position.y, cam.position.z);
  // Must match SyncedPixiPerspectiveCamera (ground plane XZ, up = -Z).
  perspCam.up.set(0, 0, -1);
  perspCam.lookAt(cam.target.x, cam.target.y, cam.target.z);
  perspCam.updateMatrixWorld();
  perspCam.updateProjectionMatrix();
  return perspCam;
}

/** Pixi world X/Z (ground) → browser client coordinates using the live Three camera. */
export function worldXZToClientScreen(
  wx: number,
  wz: number,
  rect: DOMRect,
): { x: number; y: number } | null {
  const live = sceneCameraRef.liveCamera;
  if (live) {
    live.updateMatrixWorld(true);
    worldVec.set(wx, 0, wz);
    worldVec.project(live);
    return ndcToClient(rect);
  }

  const state = sceneCameraRef.current;
  if (!state) return null;

  if (state.type === 'perspective') {
    return worldXZToScreen(wx, wz, rect, state);
  }

  const ortho = syncOrthographicCamera(state);
  worldVec.set(wx, 0, wz);
  worldVec.project(ortho);
  return ndcToClient(rect);
}

/** Pixi world X/Y (ground) → screen client coordinates. */
export function worldXZToScreen(
  wx: number,
  wz: number,
  rect: DOMRect,
  cam: PerspectiveCameraState,
): { x: number; y: number } {
  const threeCam = sceneCameraRef.liveCamera instanceof THREE.PerspectiveCamera
    ? sceneCameraRef.liveCamera
    : syncPerspectiveCamera(cam, rect.width / Math.max(rect.height, 1));
  threeCam.updateMatrixWorld(true);
  worldVec.set(wx, 0, wz);
  worldVec.project(threeCam);
  return {
    x: rect.left + (worldVec.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-worldVec.y * 0.5 + 0.5) * rect.height,
  };
}
