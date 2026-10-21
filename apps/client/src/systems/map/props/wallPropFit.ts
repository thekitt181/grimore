/**
 * Snap decorative props (torch, mural, rack, …) onto the nearest authored wall
 * and face them into the room. Optional merge sinks the prop into the wall mass.
 */
import type { ImageItem, MapItem, WallSegment } from '@/systems/scene/types';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { mapLocalPatchAfterPropMove, isMapBoundProp } from './mapBoundProps';

export type WallPropPose = {
  x: number;
  y: number;
  rotation: number;
};

export type WallFitOpts = {
  /** Sink into the wall thickness instead of sitting proud of the face. */
  merge?: boolean;
  maxDistCells?: number;
};

function mapLocalFromWorld(wx: number, wy: number, map: MapItem): { x: number; y: number } {
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + map.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + map.height / 2,
  };
}

function worldFromMapLocal(lx: number, ly: number, map: MapItem): { x: number; y: number } {
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (map.rotation * Math.PI) / 180;
  const dx = lx - map.width / 2;
  const dy = ly - map.height / 2;
  return {
    x: cx + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: cy + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function projectOnSegment(
  px: number,
  py: number,
  wall: WallSegment,
): { x: number; y: number; t: number; dist: number; ux: number; uy: number; nx: number; ny: number; len: number } | null {
  const abx = wall.b.x - wall.a.x;
  const aby = wall.b.y - wall.a.y;
  const len = Math.hypot(abx, aby);
  if (len < 2) return null;
  const ux = abx / len;
  const uy = aby / len;
  const nx = -uy;
  const ny = ux;
  const t = Math.max(0, Math.min(len, (px - wall.a.x) * ux + (py - wall.a.y) * uy));
  const x = wall.a.x + ux * t;
  const y = wall.a.y + uy * t;
  const dist = Math.hypot(px - x, py - y);
  return { x, y, t, dist, ux, uy, nx, ny, len };
}

/**
 * Place the prop center on the nearest wall.
 * - Default: inset into the room so the mesh sits on the face.
 * - merge: sink into the wall thickness (flush / recessed).
 */
export function fitPropOnNearestWall(
  map: MapItem,
  worldCx: number,
  worldCy: number,
  footprintW: number,
  footprintH: number,
  opts: WallFitOpts = {},
): WallPropPose | null {
  const walls = map.walls ?? [];
  if (walls.length === 0) return null;

  const merge = Boolean(opts.merge);
  const maxDistCells = opts.maxDistCells ?? 1.25;
  const local = mapLocalFromWorld(worldCx, worldCy, map);
  const cell = Math.max(8, map.gridSize);
  const maxDist = cell * maxDistCells;
  const halfThick = Math.max(4, cell * 0.12) * 0.55;
  const foot = Math.min(footprintW, footprintH);
  /** Proud of face vs buried in wall mass. */
  const inset = merge
    ? -(halfThick * 0.85 + foot * 0.08)
    : halfThick + foot * 0.22;

  let best: {
    lx: number;
    ly: number;
    rotationDeg: number;
    dist: number;
  } | null = null;

  for (const wall of walls) {
    const hit = projectOnSegment(local.x, local.y, wall);
    if (!hit || hit.dist > maxDist) continue;
    const side = (local.x - hit.x) * hit.nx + (local.y - hit.y) * hit.ny;
    const sign = side >= 0 ? 1 : -1;
    const lx = hit.x + hit.nx * inset * sign;
    const ly = hit.y + hit.ny * inset * sign;
    const rotationDeg = (Math.atan2(hit.ny * sign, hit.nx * sign) * 180) / Math.PI;
    if (!best || hit.dist < best.dist) {
      best = { lx, ly, rotationDeg, dist: hit.dist };
    }
  }

  if (!best) return null;
  const world = worldFromMapLocal(best.lx, best.ly, map);
  const rotation = best.rotationDeg + map.rotation;
  return {
    x: world.x - footprintW / 2,
    y: world.y - footprintH / 2,
    rotation,
  };
}

export function fitPropOnWallItem(
  item: ImageItem,
  map?: MapItem | null,
  opts?: WallFitOpts,
): WallPropPose | null {
  const m = map ?? getActiveMap();
  if (!m) return null;
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return fitPropOnNearestWall(m, cx, cy, item.width, item.height, {
    merge: opts?.merge ?? item.propWallMerge === true,
    ...(opts?.maxDistCells != null ? { maxDistCells: opts.maxDistCells } : {}),
  });
}

/** Patch to apply wall pose, keeping map-bound locals in sync. */
export function wallMountPatchForItem(
  item: ImageItem,
  pose: WallPropPose,
  map?: MapItem | null,
  extras?: Partial<ImageItem>,
): Partial<ImageItem> {
  const m = map ?? getActiveMap();
  const base: Partial<ImageItem> = {
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    propMount: 'wall',
    ...extras,
  };
  if (m && isMapBoundProp(item)) {
    return {
      ...base,
      ...mapLocalPatchAfterPropMove(
        { ...item, ...base } as ImageItem,
        m,
        pose.x,
        pose.y,
        pose.rotation,
      ),
    };
  }
  return base;
}

export const DEFAULT_WALL_PROP_HEIGHT_CELLS = 1.15;
