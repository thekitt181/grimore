import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from '@/systems/map/store/mapStore';

/** Fog distances that follow zoom so the scene is not swallowed when zoomed out. */
export function Map3DFog({ span }: { span: number }) {
  const { scene } = useThree();
  const fogRef = useRef<THREE.Fog | null>(null);

  useFrame(() => {
    const world = sceneRefs.world.current;
    const s = world
      ? world.scale.x
      : useMapStore.getState().viewport.scale;
    const sClamped = Math.max(s, 0.025);
    const radius = (span * 0.85) / sClamped;
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
