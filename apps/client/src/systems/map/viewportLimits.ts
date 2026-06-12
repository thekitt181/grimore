/** Minimum Pixi viewport scale (smaller = zoomed out farther). */
export const MIN_VIEWPORT_SCALE_2D = 0.08;
/** Keep 3D min scale reasonable — extreme zoom-out pushed the camera too far to see anything. */
export const MIN_VIEWPORT_SCALE_3D = 0.06;

export function minViewportScale(viewMode: '2d' | '3d'): number {
  return viewMode === '3d' ? MIN_VIEWPORT_SCALE_3D : MIN_VIEWPORT_SCALE_2D;
}

export function clampViewportScale(scale: number, viewMode: '2d' | '3d', maxScale: number): number {
  return Math.max(minViewportScale(viewMode), Math.min(maxScale, scale));
}

export function effectiveViewportScale(scale: number, viewMode: '2d' | '3d'): number {
  return Math.max(scale, minViewportScale(viewMode));
}
