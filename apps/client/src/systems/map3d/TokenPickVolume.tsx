import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Object3D } from 'three';
import * as THREE from 'three';
import { registerPickRoot } from './scenePickRegistry';
import { objectBoundsInParentLocal } from './objectBoundsInParentLocal';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 16);

/** Raycast pick volume — tracks model bounds when provided, else token footprint. */
export function TokenPickVolume({
  itemId,
  radius,
  height,
  y = 0,
  modelRootRef,
}: {
  itemId: string;
  radius: number;
  height: number;
  y?: number;
  /** When set, pick volume follows the loaded model each frame (prevents hitbox drift). */
  modelRootRef?: React.RefObject<Object3D | null>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.pickId = itemId;
    return registerPickRoot(mesh);
  }, [itemId]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const model = modelRootRef?.current;
    const parent = mesh.parent;
    if (model && parent && objectBoundsInParentLocal(model, parent, _box)) {
      _box.getSize(_size);
      _box.getCenter(_center);
      const r = Math.max(_size.x, _size.z) * 0.52;
      const h = Math.max(_size.y * 1.08, 8);
      mesh.position.set(_center.x, _center.y + h * 0.02, _center.z);
      mesh.scale.set(r, h, r);
      mesh.updateMatrixWorld(true);
      return;
    }

    mesh.position.set(0, y + height / 2, 0);
    mesh.scale.set(radius, height, radius);
    mesh.updateMatrixWorld(true);
  });

  return (
    <mesh ref={meshRef} geometry={_unitCylinder}>
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
