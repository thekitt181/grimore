import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef } from './sceneCameraRef';
import { applyOrthographicCameraFromViewport } from './orthographicCameraSync';
import { applyPerspectiveCameraFromViewport } from './syncPerspectiveCameraFromViewport';

/** Orthographic camera synced to Pixi pan/zoom. Top-down in 2D; orbit in 3D. */
export function SyncedPixiOrthographicCamera() {
  const { camera, size } = useThree();

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    applyOrthographicCameraFromViewport(camera, size.width, size.height);
  }, -100);

  return null;
}

/** Perspective camera with orbit angles (2D model token overlay only). */
export function SyncedPixiPerspectiveCamera() {
  const { camera, size } = useThree();

  useFrame(() => {
    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    const { view3dOrbit, viewport } = useMapStore.getState();
    const state = applyPerspectiveCameraFromViewport(
      camera,
      viewport,
      view3dOrbit,
      size.width,
      size.height,
    );

    sceneCameraRef.liveCamera = camera;
    sceneCameraRef.current = {
      type: 'perspective',
      position: { x: state.position.x, y: state.position.y, z: state.position.z },
      target: { x: state.target.x, y: state.target.y, z: state.target.z },
      fov: state.fov,
      near: state.near,
      far: state.far,
    };
  }, -100);

  return null;
}
