import type { WallSegment } from '@/systems/scene/types';

export type ExtrudedWall = {
  key: string;
  position: [number, number, number];
  size: [number, number, number];
  rotationY: number;
};

/** Build axis-aligned box transforms for wall segments (map-local → world). */
export function extrudeWallSegments(
  walls: WallSegment[],
  mapX: number,
  mapY: number,
  height: number,
  thickness: number,
): ExtrudedWall[] {
  const out: ExtrudedWall[] = [];

  for (let i = 0; i < walls.length; i++) {
    const seg = walls[i];
    if (!seg) continue;

    const ax = mapX + seg.a.x;
    const az = mapY + seg.a.y;
    const bx = mapX + seg.b.x;
    const bz = mapY + seg.b.y;
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz);
    if (length < 2) continue;

    out.push({
      key: `${i}-${ax.toFixed(1)}-${az.toFixed(1)}`,
      position: [(ax + bx) / 2, height / 2, (az + bz) / 2],
      size: [thickness, height, length],
      rotationY: Math.atan2(dx, dz),
    });
  }

  return out;
}
