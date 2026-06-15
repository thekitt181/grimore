import * as THREE from 'three';

const _inv = new THREE.Matrix4();

/** World AABB of `object`, re-expressed in `relativeTo` local space. */
export function objectBoundsInParentLocal(
  object: THREE.Object3D,
  relativeTo: THREE.Object3D,
  target: THREE.Box3,
): boolean {
  object.updateWorldMatrix(true, false);
  relativeTo.updateWorldMatrix(true, false);
  target.setFromObject(object);
  if (target.isEmpty()) return false;
  _inv.copy(relativeTo.matrixWorld).invert();
  target.applyMatrix4(_inv);
  return true;
}
