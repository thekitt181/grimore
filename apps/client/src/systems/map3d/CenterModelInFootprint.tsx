import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { meshSubtreeBoundsInParentLocal } from './objectBoundsInParentLocal';

const _box = new THREE.Box3();
const _center = new THREE.Vector3();
const _size = new THREE.Vector3();

/**
 * Keeps a token GLB centered (and sized) on the selection footprint.
 * Uncentered CAD origins otherwise leave a tiny mesh floating away from the gizmo.
 */
export function CenterModelInFootprint({
  modelRootRef,
  parentRef,
  footprintW,
  footprintH,
}: {
  modelRootRef: React.RefObject<THREE.Object3D | null>;
  parentRef: React.RefObject<THREE.Object3D | null>;
  footprintW: number;
  footprintH: number;
}) {
  const tries = useRef(0);
  const done = useRef(false);

  useEffect(() => {
    tries.current = 0;
    done.current = false;
    const model = modelRootRef.current;
    if (model) {
      model.position.set(0, 0, 0);
      model.scale.set(1, 1, 1);
    }
  }, [modelRootRef, parentRef, footprintW, footprintH]);

  useFrame(() => {
    if (done.current || tries.current > 180) return;
    tries.current += 1;

    const model = modelRootRef.current;
    const parent = parentRef.current;
    if (!model || !parent) return;

    // Let SceneModel normalize first, then lock center to the footprint.
    if (tries.current < 12) return;

    if (!meshSubtreeBoundsInParentLocal(model, parent, _box)) return;
    _box.getCenter(_center);
    _box.getSize(_size);

    const target = Math.min(footprintW, footprintH);
    const maxXZ = Math.max(_size.x, _size.z);
    // Rescue tiny failed normalizations — scale up to ~90% of the footprint.
    if (maxXZ > 1e-4 && target > 1 && maxXZ < target * 0.2) {
      const boost = (target * 0.9) / maxXZ;
      model.scale.multiplyScalar(boost);
      return; // measure again next frame after scale
    }

    if (Math.hypot(_center.x, _center.z) < 0.75) {
      // Stay open a bit longer in case normalize finishes late and nudges the mesh.
      if (tries.current > 90) done.current = true;
      return;
    }

    model.position.x -= _center.x;
    model.position.z -= _center.z;
  });

  return null;
}
