import * as THREE from 'three';
import type { PerspectiveCameraState } from './sceneCameraRef';

const perspCam = new THREE.PerspectiveCamera();
const worldVec = new THREE.Vector3();

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
  perspCam.up.set(0, 1, 0);
  perspCam.lookAt(cam.target.x, cam.target.y, cam.target.z);
  perspCam.updateMatrixWorld();
  perspCam.updateProjectionMatrix();
  return perspCam;
}

/** Pixi world X/Y (ground) → screen client coordinates. */
export function worldXZToScreen(
  wx: number,
  wz: number,
  rect: DOMRect,
  cam: PerspectiveCameraState,
): { x: number; y: number } {
  const aspect = rect.width / Math.max(rect.height, 1);
  const threeCam = syncPerspectiveCamera(cam, aspect);
  worldVec.set(wx, 0, wz);
  worldVec.project(threeCam);
  return {
    x: rect.left + (worldVec.x * 0.5 + 0.5) * rect.width,
    y: rect.top + (-worldVec.y * 0.5 + 0.5) * rect.height,
  };
}
