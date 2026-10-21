import type { Point } from '@grimoire/fog-engine';
import type { ImageItem, Item, MapItem, WallSegment } from '@/systems/scene/types';
import { losWalls, mapBoundaryWalls } from '@/systems/map/fogLos';
import { resolvePropId } from './dungeonProps';
import { canonicalPropId } from './propArt';

/** Props that seal a wall when closed and open a passage when open. */
const DOOR_PROP_IDS = new Set(['door', 'runed-door', 'secret-door', 'gate']);

/** Match Map3DCanvas extruded wall thickness so “touching” matches what you see. */
function wallHalfThickness(map: MapItem): number {
  return Math.max(4, map.gridSize * 0.12) * 0.5;
}

export function isDoorPropId(propId: string | undefined): boolean {
  if (!propId) return false;
  return DOOR_PROP_IDS.has(canonicalPropId(propId));
}

export function isDoorPropClosed(item: ImageItem): boolean {
  const id = resolvePropId(item);
  if (!isDoorPropId(id)) return false;
  return (item.propState ?? 0) <= 0;
}

export function isDoorPropOpen(item: ImageItem): boolean {
  const id = resolvePropId(item);
  if (!isDoorPropId(id)) return false;
  return (item.propState ?? 0) > 0;
}

/** Image center in map-local pixels (same math as tokenMapOrigin). */
function imageMapCenter(item: ImageItem, map: MapItem): Point {
  const wx = item.x + item.width / 2;
  const wy = item.y + item.height / 2;
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

/**
 * Door footprint corners in map-local space — same pose as the 3D prop
 * (center + item.rotation), so contact matches the visible mesh.
 */
function doorFootprintCorners(item: ImageItem, map: MapItem): Point[] {
  const c = imageMapCenter(item, map);
  const rad = ((item.rotation - map.rotation) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hx = item.width / 2;
  const hy = item.height / 2;
  const local: Array<[number, number]> = [
    [-hx, -hy],
    [hx, -hy],
    [hx, hy],
    [-hx, hy],
  ];
  return local.map(([lx, ly]) => ({
    x: c.x + lx * cos - ly * sin,
    y: c.y + lx * sin + ly * cos,
  }));
}

type WallProjection = {
  wall: WallSegment;
  ux: number;
  uy: number;
  len: number;
  t0: number;
  t1: number;
  dist: number;
};

/**
 * Where the visible door footprint touches a wall segment.
 * Returns null unless the door actually overlaps / kisses that wall in map space
 * (within extruded wall half-thickness), and only for the contact span along it.
 */
function doorVisibleWallContact(
  item: ImageItem,
  map: MapItem,
  wall: WallSegment,
): WallProjection | null {
  const abx = wall.b.x - wall.a.x;
  const aby = wall.b.y - wall.a.y;
  const len = Math.hypot(abx, aby);
  if (len < 2) return null;

  const ux = abx / len;
  const uy = aby / len;
  const nx = -uy;
  const ny = ux;
  const corners = doorFootprintCorners(item, map);

  let tMin = Infinity;
  let tMax = -Infinity;
  let nMin = Infinity;
  let nMax = -Infinity;
  for (const p of corners) {
    const t = (p.x - wall.a.x) * ux + (p.y - wall.a.y) * uy;
    const n = (p.x - wall.a.x) * nx + (p.y - wall.a.y) * ny;
    tMin = Math.min(tMin, t);
    tMax = Math.max(tMax, t);
    nMin = Math.min(nMin, n);
    nMax = Math.max(nMax, n);
  }

  // Straddling the wall line = visually through it; else nearest face distance.
  const straddles = nMin <= 0 && nMax >= 0;
  const dist = straddles ? 0 : Math.min(Math.abs(nMin), Math.abs(nMax));
  // Gates are often a bit off the red line — allow a wider kiss radius.
  const id = resolvePropId(item);
  const gatePad = id === 'gate' ? map.gridSize * 0.35 : 0;
  const touch = wallHalfThickness(map) + 2 + gatePad;
  if (dist > touch) return null;

  // Contact only along the wall where the footprint projects onto this segment.
  const t0 = Math.max(0, tMin);
  const t1 = Math.min(len, tMax);
  const overlap = t1 - t0;
  // Need a real bite of the wall — ignore glancing corner near-misses.
  // Gates: accept a narrower bite (bars span the opening).
  const minOverlap = id === 'gate'
    ? Math.max(6, Math.min(item.width, item.height) * 0.12)
    : Math.max(10, Math.min(item.width, item.height) * 0.25);
  if (overlap < minOverlap) return null;

  return { wall, ux, uy, len, t0, t1, dist };
}

/**
 * Fallback when the footprint barely misses the wall: project the prop’s long
 * axis onto the nearest wall so open gates/doors still cut a walkable gap.
 */
function nearestWallPassage(
  item: ImageItem,
  map: MapItem,
  walls: WallSegment[],
): WallProjection | null {
  const c = imageMapCenter(item, map);
  const rad = ((item.rotation - map.rotation) * Math.PI) / 180;
  // Long axis of the prop (gate/door panel across the opening).
  const long = Math.max(item.width, item.height);
  const short = Math.min(item.width, item.height);
  const alongW = item.width >= item.height;
  const ax = alongW ? Math.cos(rad) : -Math.sin(rad);
  const ay = alongW ? Math.sin(rad) : Math.cos(rad);
  const half = long * 0.45;
  const maxDist = wallHalfThickness(map) + Math.max(short * 0.6, map.gridSize * 0.4);

  let best: WallProjection | null = null;
  for (const wall of walls) {
    const abx = wall.b.x - wall.a.x;
    const aby = wall.b.y - wall.a.y;
    const len = Math.hypot(abx, aby);
    if (len < 2) continue;
    const ux = abx / len;
    const uy = aby / len;
    const nx = -uy;
    const ny = ux;
    const dist = Math.abs((c.x - wall.a.x) * nx + (c.y - wall.a.y) * ny);
    if (dist > maxDist) continue;

    const tCenter = (c.x - wall.a.x) * ux + (c.y - wall.a.y) * uy;
    // Prefer span along the wall; fall back to prop long-axis length.
    const span = half * Math.max(0.35, Math.abs(ax * ux + ay * uy));
    const t0 = Math.max(0, tCenter - Math.max(span, half * 0.35));
    const t1 = Math.min(len, tCenter + Math.max(span, half * 0.35));
    if (t1 - t0 < 6) continue;

    const hit: WallProjection = { wall, ux, uy, len, t0, t1, dist };
    if (!best || dist < best.dist - 0.5 || (Math.abs(dist - best.dist) < 0.5 && t1 - t0 > best.t1 - best.t0)) {
      best = hit;
    }
  }
  return best;
}

/** Best single wall the door/gate is on (touch first, then nearest-wall fallback). */
function bestTouchedWall(
  item: ImageItem,
  map: MapItem,
  walls: WallSegment[],
): WallProjection | null {
  let best: WallProjection | null = null;
  for (const wall of walls) {
    const hit = doorVisibleWallContact(item, map, wall);
    if (!hit) continue;
    if (
      !best
      || hit.t1 - hit.t0 > best.t1 - best.t0 + 0.5
      || (Math.abs(hit.t1 - hit.t0 - (best.t1 - best.t0)) < 0.5 && hit.dist < best.dist)
    ) {
      best = hit;
    }
  }
  if (best) return best;
  return nearestWallPassage(item, map, walls);
}

/** Cut only the contact span out of a wall segment. */
function punchDoorGap(proj: WallProjection): WallSegment[] {
  const { wall, ux, uy, len, t0, t1 } = proj;
  const out: WallSegment[] = [];
  const minKeep = 3;
  if (t0 > minKeep) {
    out.push({
      a: { x: wall.a.x, y: wall.a.y },
      b: { x: wall.a.x + ux * t0, y: wall.a.y + uy * t0 },
    });
  }
  if (len - t1 > minKeep) {
    out.push({
      a: { x: wall.a.x + ux * t1, y: wall.a.y + uy * t1 },
      b: { x: wall.b.x, y: wall.b.y },
    });
  }
  return out;
}

function sameWall(a: WallSegment, b: WallSegment): boolean {
  return (
    Math.abs(a.a.x - b.a.x) < 0.01
    && Math.abs(a.a.y - b.a.y) < 0.01
    && Math.abs(a.b.x - b.b.x) < 0.01
    && Math.abs(a.b.y - b.b.y) < 0.01
  );
}

/**
 * Closed-door seal along the visible panel (long axis).
 * Always added while shut so open→closed re-blocks punched gaps and
 * dungeon doorways that never had a red wall under the prop.
 */
function closedDoorWallSegment(item: ImageItem, map: MapItem): WallSegment | null {
  if (!isDoorPropClosed(item)) return null;

  const c = imageMapCenter(item, map);
  const rad = ((item.rotation - map.rotation) * Math.PI) / 180;
  // Panel spans the opening along the door's long axis.
  const alongW = item.width >= item.height;
  const ux = alongW ? Math.cos(rad) : -Math.sin(rad);
  const uy = alongW ? Math.sin(rad) : Math.cos(rad);
  const half = Math.max(item.width, item.height) * 0.48;
  if (half < 2) return null;
  return {
    a: { x: c.x - ux * half, y: c.y - uy * half },
    b: { x: c.x + ux * half, y: c.y + uy * half },
  };
}

function doorPropsOnMap(items: Record<string, Item> | Item[], map: MapItem): ImageItem[] {
  const list = Array.isArray(items) ? items : Object.values(items);
  return list.filter((i): i is ImageItem => {
    if (i.type !== 'image' || i.visible === false) return false;
    const id = resolvePropId(i);
    if (!isDoorPropId(id)) return false;
    const c = imageMapCenter(i, map);
    return c.x >= -i.width && c.y >= -i.height && c.x <= map.width + i.width && c.y <= map.height + i.height;
  });
}

function isGateProp(item: ImageItem): boolean {
  return canonicalPropId(resolvePropId(item) ?? '') === 'gate';
}

/** Punch openings into a wall list for the given door/gate props. */
function applyDoorGaps(
  map: MapItem,
  doors: ImageItem[],
  baseWalls: WallSegment[],
): WallSegment[] {
  let walls: WallSegment[] = baseWalls;
  for (const door of doors) {
    const touch = bestTouchedWall(door, map, walls);
    if (!touch) continue;
    walls = walls.flatMap((wall) =>
      sameWall(wall, touch.wall) ? punchDoorGap(touch) : [wall],
    );
  }
  return walls;
}

/** Punch open-door gaps into a wall list (mutates no store — returns a new array). */
function applyOpenDoorGaps(
  map: MapItem,
  items: Record<string, Item> | Item[],
  baseWalls: WallSegment[],
): WallSegment[] {
  return applyDoorGaps(
    map,
    doorPropsOnMap(items, map).filter(isDoorPropOpen),
    baseWalls,
  );
}

/**
 * Authored red walls for 2D overlay / 3D extrude.
 * Open doors punch a walk-through gap. Gates always punch so bar gaps stay
 * see-through (brick must not fill behind the portcullis).
 */
export function displayWalls(
  map: MapItem,
  items: Record<string, Item> | Item[],
): WallSegment[] {
  const doors = doorPropsOnMap(items, map);
  const toPunch = doors.filter((d) => isDoorPropOpen(d) || isGateProp(d));
  return applyDoorGaps(map, toPunch, [...(map.walls ?? [])]);
}

/**
 * LOS / fog walls: solid closed doors block vision; gates stay see-through
 * (only the bars exist in 3D — no full-panel seal for sight).
 */
export function visionWalls(
  map: MapItem,
  items: Record<string, Item> | Item[],
): WallSegment[] {
  const doors = doorPropsOnMap(items, map);
  const toPunch = doors.filter((d) => isDoorPropOpen(d) || isGateProp(d));
  return applyDoorGaps(map, toPunch, losWalls(map));
}

/** Signature of door/gate pose so wall redraws when a door toggles or a gate is placed. */
export function doorWallsSignature(
  map: MapItem,
  items: Record<string, Item> | Item[],
): string {
  return doorPropsOnMap(items, map)
    .map((d) => {
      const open = (d.propState ?? 0) > 0 ? 1 : 0;
      const gate = isGateProp(d) ? 'g' : 'd';
      return `${d.id}:${gate}${open}:${d.x.toFixed(0)},${d.y.toFixed(0)},${d.width.toFixed(0)}`;
    })
    .sort()
    .join(',');
}

/**
 * Walls used for FP / movement.
 * Open door → punch a gap only in the one wall the door footprint is visibly touching.
 * Closed door → solid wall (authored) plus a panel seal so shut props always block.
 */
export function movementWalls(
  map: MapItem,
  items: Record<string, Item> | Item[],
): WallSegment[] {
  const doors = doorPropsOnMap(items, map);
  const closedDoors = doors.filter(isDoorPropClosed);
  const baseWalls = losWalls(map);

  const walls = applyOpenDoorGaps(map, items, baseWalls);

  const extras: WallSegment[] = [];
  for (const door of closedDoors) {
    const seg = closedDoorWallSegment(door, map);
    if (seg) extras.push(seg);
  }
  // Open doors must never punch the map rim — always re-seal the boundary.
  return [...walls, ...mapBoundaryWalls(map.width, map.height), ...extras];
}
