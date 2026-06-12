import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore, type MapViewport } from '@/systems/map/store/mapStore';

/** Orthographic camera locked to the Pixi pan/zoom (top-down, Y-up ground on XZ). */
export function SyncedPixiOrthographicCamera({ viewport }: { viewport: MapViewport }) {
  const { camera, size } = useThree();

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
  });

  return null;
}

/** Perspective camera synced to Pixi pan/zoom with user-controlled orbit angles. */
export function SyncedPixiPerspectiveCamera({
  viewport,
  span,
}: {
  viewport: MapViewport;
  span: number;
}) {
  const { camera, size } = useThree();
  const orbit = useMapStore((s) => s.view3dOrbit);

  useFrame(() => {
    const { x, y, scale } = viewport;
    const s = Math.max(scale, 0.08);
    const cx = (size.width / 2 - x) / s;
    const cz = (size.height / 2 - y) / s;
    const radius = (span * 0.85) / s;
    const sinP = Math.sin(orbit.polar);
    const cosP = Math.cos(orbit.polar);
    const sinA = Math.sin(orbit.azimuth);
    const cosA = Math.cos(orbit.azimuth);

    camera.position.set(
      cx + radius * sinP * sinA,
      radius * cosP,
      cz + radius * sinP * cosA,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(cx, 0, cz);
    camera.near = Math.max(0.5, radius * 0.002);
    camera.far = Math.max(radius * 16, span * 4);
    camera.updateProjectionMatrix();
  });

  return null;
}
