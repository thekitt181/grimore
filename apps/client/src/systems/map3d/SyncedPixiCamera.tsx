import { useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { MapViewport } from '@/systems/map/store/mapStore';

type OrbitControlsLike = { target: THREE.Vector3; update: () => void };

/** Orthographic camera locked to the Pixi pan/zoom (top-down, Y-up ground on XZ). */
export function SyncedPixiOrthographicCamera({ viewport }: { viewport: MapViewport }) {
  const { camera, size } = useThree();
  const ready = useRef(false);

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const { x, y, scale } = viewport;
    const s = Math.max(scale, 0.08);
    const halfW = size.width / (2 * s);
    const halfH = size.height / (2 * s);
    const cx = (size.width / 2 - x) / s;
    const cz = (size.height / 2 - y) / s;

    camera.left = cx - halfW;
    camera.right = cx + halfW;
    camera.top = cz - halfH;
    camera.bottom = cz + halfH;
    camera.near = 0.1;
    camera.far = 8000;
    camera.position.set(cx, 1200, cz);
    camera.up.set(0, 0, -1);
    camera.rotation.set(-Math.PI / 2, 0, 0);
    camera.updateProjectionMatrix();
    ready.current = true;
  });

  return null;
}

/** Perspective orbit camera driven by Pixi viewport (pan/zoom on 2D layer). */
export function SyncedPixiPerspectiveCamera({
  viewport,
  span,
  controlsRef,
}: {
  viewport: MapViewport;
  span: number;
  controlsRef: RefObject<OrbitControlsLike | null>;
}) {
  const { camera, size } = useThree();

  useFrame(() => {
    const { x, y, scale } = viewport;
    const s = Math.max(scale, 0.08);
    const cx = (size.width / 2 - x) / s;
    const cz = (size.height / 2 - y) / s;
    const dist = (span * 0.85) / s;
    const camY = (span * 0.55) / s;

    camera.position.set(cx + dist * 0.707, camY, cz + dist * 0.707);
    camera.lookAt(cx, 0, cz);

    const controls = controlsRef.current;
    if (controls) {
      controls.target.set(cx, 0, cz);
      controls.update();
    }
  });

  return null;
}
