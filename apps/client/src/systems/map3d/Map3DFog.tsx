import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';

/** Fog distances that follow zoom so the scene is not swallowed when zoomed out. */
export function Map3DFog({ span }: { span: number }) {
  const viewport = useMapStore((s) => s.viewport);
  const { scene } = useThree();
  const fogRef = useRef<THREE.Fog | null>(null);

  useFrame(() => {
    const s = Math.max(viewport.scale, 0.08);
    const radius = (span * 0.85) / s;
    if (!fogRef.current) {
      fogRef.current = new THREE.Fog('#1e1e22', radius * 1.5, radius * 14);
      scene.fog = fogRef.current;
    } else {
      fogRef.current.near = radius * 1.5;
      fogRef.current.far = radius * 14;
    }
  });

  return null;
}
