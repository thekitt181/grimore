/** Orbit distance so 3D ground scale matches Pixi viewport zoom (world units per pixel). */
export function perspectiveOrbitRadius(
  screenH: number,
  scale: number,
  fovDeg: number,
  polar: number,
): number {
  const fovRad = (fovDeg * Math.PI) / 180;
  const sinP = Math.max(Math.sin(polar), 0.12);
  const safeScale = Math.max(scale, 1e-6);
  return screenH / safeScale / (2 * Math.tan(fovRad / 2) * sinP);
}
