import * as THREE from 'three';
import type { PerspectiveCameraState } from './sceneCameraRef';

const ndc = new THREE.Vector2();
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
const perspCam = new THREE.PerspectiveCamera();

/** Map a screen click to ground-plane XZ (Pixi world x/y) using the live 3D camera. */
export function screenToGroundXZ(
  clientX: number,
  clientY: number,
  canvasRect: DOMRect,
  cam: PerspectiveCameraState,
): { x: number; y: number } | null {
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;

  ndc.x = ((clientX - canvasRect.left) / canvasRect.width) * 2 - 1;
  ndc.y = -((clientY - canvasRect.top) / canvasRect.height) * 2 + 1;

  perspCam.fov = cam.fov;
  perspCam.aspect = canvasRect.width / canvasRect.height;
  perspCam.near = 0.1;
  perspCam.far = 100_000;
  perspCam.position.set(cam.position.x, cam.position.y, cam.position.z);
  perspCam.up.set(0, 1, 0);
  perspCam.lookAt(cam.target.x, cam.target.y, cam.target.z);
  perspCam.updateMatrixWorld();
  perspCam.updateProjectionMatrix();

  raycaster.setFromCamera(ndc, perspCam);
  const hit = raycaster.ray.intersectPlane(groundPlane, hitPoint);
  if (!hit) return null;

  return { x: hitPoint.x, y: hitPoint.z };
}
