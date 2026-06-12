import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import { registerPickRoot } from './scenePickRegistry';

/** Raycast pick surface — must stay visible (Three.js skips invisible meshes). */
export function MapPickVolume({ map }: { map: MapItem }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.pickId = map.id;
    return registerPickRoot(mesh);
  }, [map.id]);

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
      <planeGeometry args={[map.width, map.height]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}
