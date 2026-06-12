import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { registerPickRoot } from './scenePickRegistry';

/** Invisible pick mesh aligned to token footprint (raycast selection from any angle). */
export function TokenPickVolume({
  itemId,
  radius,
  height,
  y = 0,
}: {
  itemId: string;
  radius: number;
  height: number;
  y?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.userData.pickId = itemId;
    return registerPickRoot(mesh);
  }, [itemId]);

  return (
    <mesh ref={meshRef} position={[0, y + height / 2, 0]} visible={false}>
      <cylinderGeometry args={[radius, radius, height, 16]} />
      <meshBasicMaterial />
    </mesh>
  );
}
