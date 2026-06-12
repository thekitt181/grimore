import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { sceneCameraRef } from './sceneCameraRef';
import { viewportGroundCenter } from './viewportGroundCenter';
import { minViewportScale } from '@/systems/map/viewportLimits';

function pixiScreenSize(fallbackW: number, fallbackH: number): { w: number; h: number } {
  const app = sceneRefs.app.current;
  if (app) return { w: app.screen.width, h: app.screen.height };
  return { w: fallbackW, h: fallbackH };
}

/** Orthographic camera locked to the Pixi pan/zoom (top-down, Y-up ground on XZ). */
export function SyncedPixiOrthographicCamera() {
  const { camera, size } = useThree();

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    const { viewMode, viewport } = useMapStore.getState();
    const { w, h } = pixiScreenSize(size.width, size.height);
    const { cx, cz, scale: s } = viewportGroundCenter(viewport, w, h);
    const halfW = w / (2 * s);
    const halfH = h / (2 * s);

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
    const { w, h } = pixiScreenSize(size.width, size.height);
    const { cx, cz, scale: s } = viewportGroundCenter(viewport, w, h);

    const orbitScale = Math.max(s, minViewportScale(viewMode));
    const radius = (span * 0.85) / orbitScale;
    const minRadius = span * 0.12;
    const maxRadius = span * 2.8;
    const orbitRadius = THREE.MathUtils.clamp(radius, minRadius, maxRadius);

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
    camera.near = Math.max(0.5, orbitRadius * 0.002);
    camera.far = Math.max(orbitRadius * 20, span * 8);
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
