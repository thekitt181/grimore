/** Minimum Pixi viewport scale (smaller = zoomed out farther). */
export const MIN_VIEWPORT_SCALE_2D = 0.004;
/** Absolute floor for 3D zoom-out (large maps). */
export const MIN_VIEWPORT_SCALE_3D = 0.004;

export interface ViewportScaleContext {
  mapWidth: number;
  mapHeight: number;
  screenW: number;
  screenH: number;
}

/** Smallest allowed scale — absolute floor only (same range in 2D and 3D). */
export function minViewportScale(
  viewMode: '2d' | '3d',
  _ctx?: ViewportScaleContext,
): number {
  void _ctx;
  return viewMode === '3d' ? MIN_VIEWPORT_SCALE_3D : MIN_VIEWPORT_SCALE_2D;
}

export function maxViewportScale(isMobile: boolean): number {
  return isMobile ? 24 : 8;
}

export function viewportScaleLimits(
  viewMode: '2d' | '3d',
  isMobile: boolean,
  ctx?: ViewportScaleContext,
): { min: number; max: number } {
  return {
    min: minViewportScale(viewMode, ctx),
    max: maxViewportScale(isMobile),
  };
}

export function clampViewportScale(
  scale: number,
  viewMode: '2d' | '3d',
  maxScale: number,
  ctx?: ViewportScaleContext,
): number {
  return Math.max(minViewportScale(viewMode, ctx), Math.min(maxScale, scale));
}

export function effectiveViewportScale(
  scale: number,
  viewMode: '2d' | '3d',
  ctx?: ViewportScaleContext,
): number {
  return Math.max(scale, minViewportScale(viewMode, ctx));
}
