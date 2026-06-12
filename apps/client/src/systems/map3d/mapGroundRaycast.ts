import { useSyncExternalStore } from 'react';
import * as THREE from 'three';

const raycastRoots = new Set<THREE.Object3D>();
let version = 0;
const listeners = new Set<() => void>();

function bumpVersion() {
  version += 1;
  for (const l of listeners) l();
}

/** Register a loaded map GLB/STL root for ground-height raycasts (token placement). */
export function registerMapRaycastRoot(root: THREE.Object3D): () => void {
  raycastRoots.add(root);
  bumpVersion();
  return () => {
    raycastRoots.delete(root);
    bumpVersion();
  };
}

export function useMapRaycastVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
  );
}

const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3(0, -1, 0);
const raycaster = new THREE.Raycaster();

/** Sample walkable height at world X/Z; falls back when no 3D map mesh is loaded yet. */
export function groundHeightAt(x: number, z: number, fallback = 0): number {
  if (raycastRoots.size === 0) return fallback;

  rayOrigin.set(x, 50_000, z);
  raycaster.set(rayOrigin, rayDir);

  let bestY = fallback;
  let bestDist = Infinity;

  for (const root of raycastRoots) {
    const hits = raycaster.intersectObject(root, true);
    for (const hit of hits) {
      if (hit.distance < bestDist) {
        bestDist = hit.distance;
        bestY = hit.point.y;
      }
    }
  }

  return bestY;
}
