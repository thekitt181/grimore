import type { ImageItem, MapItem, WallSegment } from '@/systems/scene/types';
import { degToRad } from './coords';

type WallRun = { dx: number; dz: number; mx: number; mz: number; dist: number };

/** Nearest authored wall segment in Three XZ (map-local walls + map.x / map.y). */
function nearestWallRun(item: ImageItem, map: MapItem): WallRun | null {
  const walls = map.walls ?? [];
  if (!walls.length) return null;

  const cx = item.x + item.width / 2;
  const cz = item.y + item.height / 2;
  let best: WallRun | null = null;

  const consider = (seg: WallSegment) => {
    const ax = map.x + seg.a.x;
    const az = map.y + seg.a.y;
    const bx = map.x + seg.b.x;
    const bz = map.y + seg.b.y;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 2) return;

    const ux = dx / len;
    const uz = dz / len;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const dist = Math.abs((cx - ax) * (-uz) + (cz - az) * ux);
    const maxDist = Math.max(map.gridSize * 2.5, Math.max(item.width, item.height) * 1.8);
    if (dist > maxDist) return;

    if (!best || dist < best.dist - 0.5) {
      best = { dx, dz, mx, mz, dist };
    }
  };

  for (const seg of walls) consider(seg);
  return best;
}

/**
 * Y rotation for SceneItemTransformGroup so item.width runs along the wall
 * (same convention as extrudeWallSegments rotationY = atan2(dx, dz)).
 */
export function doorOpeningSpinYRad(item: ImageItem, map: MapItem | null | undefined): number | undefined {
  if (!map) return undefined;
  const run = nearestWallRun(item, map);
  if (!run) return undefined;
  return Math.atan2(run.dx, run.dz);
}

/** Outward horizontal normal (Three XZ) for panel facing — points toward the door center. */
export function doorWallFaceNormalXZ(
  item: ImageItem,
  map: MapItem | null | undefined,
): { nx: number; nz: number } | null {
  if (!map) return null;
  const run = nearestWallRun(item, map);
  if (!run) return null;

  const cx = item.x + item.width / 2;
  const cz = item.y + item.height / 2;
  const spin = Math.atan2(run.dx, run.dz);
  let nx = Math.cos(spin);
  let nz = -Math.sin(spin);
  if ((cx - run.mx) * nx + (cz - run.mz) * nz < 0) {
    nx = -nx;
    nz = -nz;
  }
  return { nx, nz };
}

/**
 * Extra Y rotation inside the prop (after parent spin) so +Z panel normal matches the wall.
 * Usually ~0 when parent spin uses doorOpeningSpinYRad.
 */
export function doorPanelExtraYawRad(item: ImageItem, map: MapItem | null | undefined): number {
  const n = doorWallFaceNormalXZ(item, map);
  if (!n) return 0;

  const spin = doorOpeningSpinYRad(item, map) ?? degToRad(item.rotation ?? 0);
  const target = Math.atan2(-n.nx, n.nz);
  let extra = target - spin;
  while (extra > Math.PI) extra -= Math.PI * 2;
  while (extra < -Math.PI) extra += Math.PI * 2;
  if (Math.abs(extra) < 0.04) return 0;
  return extra;
}
