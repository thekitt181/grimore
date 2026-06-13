import type * as THREE from 'three';

/** Live Three.js camera snapshot for picking and ground projection. */
export type PerspectiveCameraState = {
  type: 'perspective';
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
  fov: number;
  near: number;
  far: number;
};

export type OrthographicCameraState = {
  type: 'orthographic';
  left: number;
  right: number;
  top: number;
  bottom: number;
  position: { x: number; y: number; z: number };
  target: { x: number; y: number; z: number };
};

export type SceneCameraState = PerspectiveCameraState | OrthographicCameraState;

export const sceneCameraRef = {
  current: null as SceneCameraState | null,
  /** Actual R3F camera — use for raycast/screen projection (matches rendered frame). */
  liveCamera: null as THREE.Camera | null,
};

/** @deprecated use sceneCameraRef */
export const view3dCameraRef = {
  get current() {
    const c = sceneCameraRef.current;
    return c?.type === 'perspective' ? c : null;
  },
};
