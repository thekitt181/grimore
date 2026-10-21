import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef } from './sceneCameraRef';
import { applyOrthographicCameraFromViewport } from './orthographicCameraSync';
import { applyPerspectiveCameraFromViewport } from './syncPerspectiveCameraFromViewport';

/** Orthographic camera synced to Pixi pan/zoom. Top-down in 2D; orbit in 3D. */
export function SyncedPixiOrthographicCamera() {
  const { camera, size } = useThree();
  const gm2dEditorOpen = useMapStore((s) => s.gm2dEditorOpen);

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    // Split pane: Pixi is only the right editor — use this canvas size for the 3D frustum.
    applyOrthographicCameraFromViewport(camera, size.width, size.height, {
      useLocalSize: gm2dEditorOpen,
    });
  }, -100);

  return null;
}

/**
 * Top-down camera for the GM 2D editor underlay — follows Pixi pan/zoom but never
 * steals the live pick camera used by the main 3D pane.
 */
export function SyncedPixiTopDownDisplayCamera() {
  const { camera, size } = useThree();

  useFrame(() => {
    if (!(camera instanceof THREE.OrthographicCamera)) return;
    applyOrthographicCameraFromViewport(camera, size.width, size.height, {
      projection: 'topdown',
      bindSceneCamera: false,
      useLocalSize: true,
    });
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
