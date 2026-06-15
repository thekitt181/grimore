import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Object3D } from 'three';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import { registerPickRoot } from './scenePickRegistry';
import { meshSubtreeBoundsInParentLocal, objectBoundsInParentLocal } from './objectBoundsInParentLocal';

const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _center = new THREE.Vector3();
const _unitBox = new THREE.BoxGeometry(1, 1, 1);

/** Raycast pick surface — tracks GLB bounds when provided, else flat map footprint. */
export function MapPickVolume({
  map,
  modelRootRef,
}: {
  map: MapItem;
  /** When set, pick volume follows the loaded model each frame (prevents hitbox drift). */
  modelRootRef?: React.RefObject<Object3D | null>;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.pickId = map.id;
    return registerPickRoot(mesh);
  }, [map.id]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const model = modelRootRef?.current;
    const parent = mesh.parent;
    if (model && parent) {
      parent.updateWorldMatrix(true, true);
      const ok =
        meshSubtreeBoundsInParentLocal(model, parent, _box)
        || objectBoundsInParentLocal(model, parent, _box);
      if (ok) {
        _box.getSize(_size);
        _box.getCenter(_center);
        mesh.rotation.set(0, 0, 0);
        mesh.position.copy(_center);
        mesh.scale.set(
          Math.max(_size.x * 1.02, 4),
          Math.max(_size.y * 1.02, 4),
          Math.max(_size.z * 1.02, 4),
        );
        mesh.updateMatrixWorld(true);
        return;
      }
    }

    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.position.set(0, 0.04, 0);
    mesh.scale.set(map.width, map.height, 1);
    mesh.updateMatrixWorld(true);
  });

  return (
    <mesh ref={meshRef} geometry={_unitBox}>
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
