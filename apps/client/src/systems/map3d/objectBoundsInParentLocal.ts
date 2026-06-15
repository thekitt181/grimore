import * as THREE from 'three';

const _inv = new THREE.Matrix4();
const _point = new THREE.Vector3();

/** World AABB of `object`, re-expressed in `relativeTo` local space. */
export function objectBoundsInParentLocal(
  object: THREE.Object3D,
  relativeTo: THREE.Object3D,
  target: THREE.Box3,
): boolean {
  if (object === relativeTo) {
    // Never measure a group against itself — world coords leak as local positions.
    if (!relativeTo.parent) return false;
    return objectBoundsInParentLocal(object, relativeTo.parent, target);
  }

  relativeTo.updateWorldMatrix(true, true);
  object.updateWorldMatrix(true, false);
  target.setFromObject(object);
  if (target.isEmpty()) return false;
  _inv.copy(relativeTo.matrixWorld).invert();
  target.applyMatrix4(_inv);
  return true;
}

/** Tight local AABB of mesh geometry under `root`, in `relativeTo` local space. */
export function meshSubtreeBoundsInParentLocal(
  root: THREE.Object3D,
  relativeTo: THREE.Object3D,
  target: THREE.Box3,
): boolean {
  relativeTo.updateWorldMatrix(true, true);
  root.updateWorldMatrix(true, true);
  _inv.copy(relativeTo.matrixWorld).invert();

  target.makeEmpty();
  let found = false;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry;
    if (!geo.boundingBox) geo.computeBoundingBox();
    if (!geo.boundingBox) return;

    const { min, max } = geo.boundingBox;
    for (const x of [min.x, max.x]) {
      for (const y of [min.y, max.y]) {
        for (const z of [min.z, max.z]) {
          _point.set(x, y, z).applyMatrix4(mesh.matrixWorld).applyMatrix4(_inv);
          target.expandByPoint(_point);
          found = true;
        }
      }
    }
  });

  return found && !target.isEmpty();
}
