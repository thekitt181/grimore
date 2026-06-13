import * as THREE from 'three';

/** Max manual orbit on 2D GLB minis — front → side → back (not full 360). */
export const VIEW2D_MINI_ORBIT_MAX = Math.PI / 2;

export function clampView2dMiniOrbitAzimuth(azimuth: number): number {
  return THREE.MathUtils.clamp(azimuth, -VIEW2D_MINI_ORBIT_MAX, VIEW2D_MINI_ORBIT_MAX);
}
