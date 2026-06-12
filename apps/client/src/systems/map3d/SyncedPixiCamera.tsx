import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef } from './sceneCameraRef';
import { effectiveViewportScale } from '@/systems/map/viewportLimits';

/** Orthographic camera locked to the Pixi pan/zoom (top-down, Y-up ground on XZ). */
export function SyncedPixiOrthographicCamera() {
  const { camera, size } = useThree();

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const { viewMode, viewport } = useMapStore.getState();
    const { x, y, scale } = viewport;
    const s = effectiveViewportScale(scale, viewMode);
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

    sceneCameraRef.current = {
      type: 'orthographic',
      left: camera.left,
      right: camera.right,
      top: camera.top,
      bottom: camera.bottom,
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    };
  });

  return null;
}

/** Perspective camera synced to Pixi pan/zoom with user-controlled orbit angles. */
export function SyncedPixiPerspectiveCamera({ span }: { span: number }) {
  const { camera, size } = useThree();

  useFrame(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const { viewMode, view3dOrbit, viewport } = useMapStore.getState();
    const { x, y, scale } = viewport;
    const s = effectiveViewportScale(scale, viewMode);
    const cx = (size.width / 2 - x) / s;
    const cz = (size.height / 2 - y) / s;
    const radius = (span * 1.15) / s;
    const minRadius = (span * 0.04) / Math.max(s, 0.08);
    const orbitRadius = Math.max(radius, minRadius);
    const sinP = Math.sin(view3dOrbit.polar);
    const cosP = Math.cos(view3dOrbit.polar);
    const sinA = Math.sin(view3dOrbit.azimuth);
    const cosA = Math.cos(view3dOrbit.azimuth);

    camera.position.set(
      cx + orbitRadius * sinP * sinA,
      orbitRadius * cosP,
      cz + orbitRadius * sinP * cosA,
    );
    camera.up.set(0, 1, 0);
    camera.lookAt(cx, 0, cz);
    camera.near = Math.max(0.5, orbitRadius * 0.001);
    camera.far = Math.max(orbitRadius * 24, span * 12);
    camera.updateProjectionMatrix();

    sceneCameraRef.current = {
      type: 'perspective',
      position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      target: { x: cx, y: 0, z: cz },
      fov: camera.fov,
      near: camera.near,
      far: camera.far,
    };
  });

  return null;
}
