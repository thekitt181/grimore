import type { PerspectiveCamera } from 'three';
import type { MapViewport, View3DOrbit } from '@/systems/map/store/mapStore';
import { viewportGroundCenter } from './viewportGroundCenter';
import { perspectiveOrbitRadius } from './perspectiveOrbitRadius';
import { syncedCanvasSize } from './syncedCanvasSize';
import type { PerspectiveCameraState } from './sceneCameraRef';

export function computePerspectiveCameraState(
  viewport: MapViewport,
  view3dOrbit: View3DOrbit,
  fovDeg: number,
  fallbackW: number,
  fallbackH: number,
): PerspectiveCameraState & { cx: number; cz: number } {
  const { w: sw, h: sh } = syncedCanvasSize(fallbackW, fallbackH);
  const { cx, cz, scale: s } = viewportGroundCenter(viewport, sw, sh);
  const orbitRadius = perspectiveOrbitRadius(sh, s, fovDeg, view3dOrbit.polar);

  const sinP = Math.sin(view3dOrbit.polar);
  const cosP = Math.cos(view3dOrbit.polar);
  const sinA = Math.sin(view3dOrbit.azimuth);
  const cosA = Math.cos(view3dOrbit.azimuth);

  const x = cx + orbitRadius * sinP * sinA;
  const y = orbitRadius * cosP;
  const z = cz + orbitRadius * sinP * cosA;

  return {
    cx,
    cz,
    type: 'perspective',
    position: { x, y, z },
    target: { x: cx, y: 0, z: cz },
    fov: fovDeg,
    near: Math.max(0.5, orbitRadius * 0.002),
    far: Math.max(orbitRadius * 24, sh / Math.max(s, 1e-6) * 4),
  };
}

/** Apply Pixi pan/zoom + orbit angles to a live Three.js perspective camera. */
export function applyPerspectiveCameraFromViewport(
  camera: PerspectiveCamera,
  viewport: MapViewport,
  view3dOrbit: View3DOrbit,
  fallbackW: number,
  fallbackH: number,
): ReturnType<typeof computePerspectiveCameraState> {
  const state = computePerspectiveCameraState(
    viewport,
    view3dOrbit,
    camera.fov,
    fallbackW,
    fallbackH,
  );
  const { w: sw, h: sh } = syncedCanvasSize(fallbackW, fallbackH);

  camera.position.set(state.position.x, state.position.y, state.position.z);
  camera.up.set(0, 0, -1);
  camera.lookAt(state.target.x, state.target.y, state.target.z);
  camera.aspect = sw / Math.max(sh, 1);
  camera.near = state.near;
  camera.far = state.far;
  camera.updateProjectionMatrix();

  return state;
}
