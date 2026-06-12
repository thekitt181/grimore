import * as THREE from 'three';

/** Scale + center a loaded model to a target world size; returns false when bounds are not ready. */
export function applyModelNormalization(
  root: THREE.Object3D,
  targetSize: number,
  groundAlign: boolean,
): boolean {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return false;

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(maxDim) || maxDim < 1e-6) return false;

  const scaleFactor = THREE.MathUtils.clamp(targetSize / maxDim, 1e-3, 1e3);
  root.scale.setScalar(scaleFactor);
  root.updateMatrixWorld(true);

  box.setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  if (groundAlign) {
    box.setFromObject(root);
    root.position.y -= box.min.y;
  } else {
    root.position.y -= center.y;
  }

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
