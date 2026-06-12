import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import { registerPickRoot } from './scenePickRegistry';

/** Invisible pick surface for a map item (GM selection in 3D). */
export function MapPickVolume({ map }: { map: MapItem }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.pickId = map.id;
    return registerPickRoot(mesh);
  }, [map.id]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} visible={false}>
      <planeGeometry args={[map.width, map.height]} />
      <meshBasicMaterial />
    </mesh>
  );
}
