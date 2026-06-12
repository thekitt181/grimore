/** Live 3D camera pose — updated each frame from SyncedPixiPerspectiveCamera. */
export type View3DCameraState = {
  position: { x: number; y: number; z: number };
  /** lookAt target on the ground plane */
  target: { x: number; y: number; z: number };
  fov: number;
};

export const view3dCameraRef = { current: null as View3DCameraState | null };
