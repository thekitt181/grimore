import * as THREE from 'three';
import { measureTokenMeshBottomWorldY } from './tokenFootPlant';
import { detectHumanoidBones, rootHasSkinnedMesh } from './tokenSmartRig';

const _hip = new THREE.Vector3();
const _head = new THREE.Vector3();
const _up = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();

/** Rigged GLBs: stand up using hips→head when bind pose is sideways / Z-up. */
export function uprightSkinnedHumanoidToY(root: THREE.Object3D): boolean {
  const bones = detectHumanoidBones(root);
  if (!bones.hips || !bones.head) return false;

  root.updateMatrixWorld(true);
  bones.hips.getWorldPosition(_hip);
  bones.head.getWorldPosition(_head);
  _up.copy(_head).sub(_hip);
  if (_up.lengthSq() < 1e-8) return false;
  _up.normalize();
  if (_up.y > 0.82) return false;

  _q.setFromUnitVectors(_up, _worldUp);
  root.quaternion.premultiply(_q);
  root.updateMatrixWorld(true);
  return true;
}

/**
 * Token GLBs often import Z-up or lying on their side. If Y is clearly not the
 * tall axis, rotate once so the longest dimension points up before scale/ground.
 */
export function uprightModelLongAxisToY(root: THREE.Object3D): void {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return;

  const size = box.getSize(new THREE.Vector3());
  const sx = size.x;
  const sy = size.y;
  const sz = size.z;
  const maxDim = Math.max(sx, sy, sz);
  if (!Number.isFinite(maxDim) || maxDim < 1e-6) return;

  if (sy >= maxDim * 0.9) return;
  if (sy >= Math.max(sx, sz) * 0.55) return;

  if (sx >= sz && sx >= sy) {
    root.rotateZ(Math.PI / 2);
  } else if (sz >= sx && sz >= sy) {
    root.rotateX(-Math.PI / 2);
  } else if (sy <= Math.min(sx, sz) * 0.45) {
    if (sx >= sz) root.rotateZ(Math.PI / 2);
    else root.rotateX(-Math.PI / 2);
  }

  root.updateMatrixWorld(true);
}

/** Token minis: skeleton-aware upright, then mesh AABB fallback. */
export function applyTokenUprightOrientation(root: THREE.Object3D): void {
  if (rootHasSkinnedMesh(root)) {
    if (uprightSkinnedHumanoidToY(root)) return;
  }
  uprightModelLongAxisToY(root);
}

function restoreLocalTransform(
  root: THREE.Object3D,
  pos: THREE.Vector3,
  rot: THREE.Euler,
  scale: THREE.Vector3,
  parent: THREE.Object3D | null,
): void {
  root.position.copy(pos);
  root.rotation.copy(rot);
  root.scale.copy(scale);
  if (parent && root.parent !== parent) parent.add(root);
  root.updateMatrixWorld(true);
}

/**
 * Scale + center a loaded model to a target world size.
 * Measures in local space (temporarily detached) so a moved/rotated parent cannot
 * shrink the model on re-normalize. Restores prior TRS if bounds are not ready.
 */
export function applyModelNormalization(
  root: THREE.Object3D,
  targetSize: number,
  groundAlign: boolean,
  footprint?: { width: number; height: number },
  /** Table minis: stand up Z-up / sideways exports before footprint scaling. */
  tokenUpright = false,
): boolean {
  const prevParent = root.parent;
  const prevPos = root.position.clone();
  const prevRot = root.rotation.clone();
  const prevScale = root.scale.clone();

  // Detach so setFromObject ignores parent move/rotate/scale (re-normalize after drag).
  if (prevParent) prevParent.remove(root);

  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  if (tokenUpright) applyTokenUprightOrientation(root);

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) {
    restoreLocalTransform(root, prevPos, prevRot, prevScale, prevParent);
    return false;
  }

  const size = box.getSize(new THREE.Vector3());
  let scaleFactor: number;
  if (footprint && size.x > 1e-6 && size.z > 1e-6) {
    scaleFactor = Math.min(footprint.width / size.x, footprint.height / size.z);
  } else {
    const maxDim = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(maxDim) || maxDim < 1e-6) {
      restoreLocalTransform(root, prevPos, prevRot, prevScale, prevParent);
      return false;
    }
    scaleFactor = targetSize / maxDim;
  }
  scaleFactor = THREE.MathUtils.clamp(scaleFactor, 1e-3, 1e3);
  root.scale.setScalar(scaleFactor);
  root.updateMatrixWorld(true);

  box.setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  if (groundAlign) {
    root.updateMatrixWorld(true);
    const meshFloor = tokenUpright ? measureTokenMeshBottomWorldY(root) : null;
    if (meshFloor != null && Number.isFinite(meshFloor)) {
      root.position.y -= meshFloor;
    } else {
      box.setFromObject(root);
      root.position.y -= box.min.y;
    }
  } else {
    root.position.y -= center.y;
  }

  if (prevParent) prevParent.add(root);
  root.updateMatrixWorld(true);
  return true;
}

/** Last resort when bounds are missing — avoids rendering at raw CAD scale (fills the screen). */
export function applyFallbackModelNormalization(
  root: THREE.Object3D,
  targetSize: number,
  groundAlign: boolean,
): void {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.setScalar(targetSize / 100);
  if (groundAlign) {
    root.position.y = 0;
  }
}
