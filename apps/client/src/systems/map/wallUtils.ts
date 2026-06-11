import type { MapItem, WallSegment } from '@/systems/scene/types';

export const WALL_ERASE_RADIUS = 14;
export const MIN_WALL_SEGMENT_LEN = 4;

export function distToSegment(px: number, py: number, seg: WallSegment): number {
  const { a, b } = seg;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
}

export function toMapLocal(wx: number, wy: number, map: MapItem) {
  return { x: wx - map.x, y: wy - map.y };
}

export function nearestWallIndex(
  localX: number,
  localY: number,
  walls: WallSegment[],
  radius = WALL_ERASE_RADIUS,
): number {
  let bestIdx = -1;
  let bestD = radius;
  walls.forEach((seg, i) => {
    const d = distToSegment(localX, localY, seg);
    if (d < bestD) {
      bestD = d;
      bestIdx = i;
    }
  });
  return bestIdx;
}

export function worldPointsToWallSegments(worldPts: number[], map: MapItem): WallSegment[] {
  const segs: WallSegment[] = [];
  for (let i = 0; i < worldPts.length - 2; i += 2) {
    const a = toMapLocal(worldPts[i]!, worldPts[i + 1]!, map);
    const b = toMapLocal(worldPts[i + 2]!, worldPts[i + 3]!, map);
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_WALL_SEGMENT_LEN) continue;
    segs.push({ a, b });
  }
  return segs;
}

export function worldRectToWallSegments(wx1: number, wy1: number, wx2: number, wy2: number, map: MapItem): WallSegment[] {
  const lx1 = Math.min(wx1, wx2) - map.x;
  const ly1 = Math.min(wy1, wy2) - map.y;
  const lx2 = Math.max(wx1, wx2) - map.x;
  const ly2 = Math.max(wy1, wy2) - map.y;
  if (Math.abs(lx2 - lx1) < MIN_WALL_SEGMENT_LEN && Math.abs(ly2 - ly1) < MIN_WALL_SEGMENT_LEN) return [];

  const corners = [
    { x: lx1, y: ly1 },
    { x: lx2, y: ly1 },
    { x: lx2, y: ly2 },
    { x: lx1, y: ly2 },
  ];
  const segs: WallSegment[] = [];
  for (let i = 0; i < 4; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % 4]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_WALL_SEGMENT_LEN) segs.push({ a, b });
  }
  return segs;
}

export function worldEllipseToWallSegments(
  wx1: number,
  wy1: number,
  wx2: number,
  wy2: number,
  map: MapItem,
  steps = 32,
): WallSegment[] {
  const cx = (wx1 + wx2) / 2 - map.x;
  const cy = (wy1 + wy2) / 2 - map.y;
  const rx = Math.abs(wx2 - wx1) / 2;
  const ry = Math.abs(wy2 - wy1) / 2;
  if (rx < MIN_WALL_SEGMENT_LEN / 2 && ry < MIN_WALL_SEGMENT_LEN / 2) return [];

  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  const segs: WallSegment[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (Math.hypot(b.x - a.x, b.y - a.y) >= MIN_WALL_SEGMENT_LEN) segs.push({ a, b });
  }
  return segs;
}

function segmentsIntersect(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const denom = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(denom) < 1e-9) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / denom;
  const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function pointInRect(px: number, py: number, rx: number, ry: number, rw: number, rh: number): boolean {
  return px >= rx && px <= rx + rw && py >= ry && py <= ry + rh;
}

export function segmentIntersectsWorldRect(
  seg: WallSegment,
  map: MapItem,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): boolean {
  const ax = seg.a.x + map.x;
  const ay = seg.a.y + map.y;
  const bx = seg.b.x + map.x;
  const by = seg.b.y + map.y;

  if (pointInRect(ax, ay, rx, ry, rw, rh) || pointInRect(bx, by, rx, ry, rw, rh)) return true;

  const edges = [
    [rx, ry, rx + rw, ry],
    [rx + rw, ry, rx + rw, ry + rh],
    [rx + rw, ry + rh, rx, ry + rh],
    [rx, ry + rh, rx, ry],
  ] as const;
  for (const [x1, y1, x2, y2] of edges) {
    if (segmentsIntersect(ax, ay, bx, by, x1, y1, x2, y2)) return true;
  }
  return false;
}

export function wallIndicesInWorldRect(
  walls: WallSegment[],
  map: MapItem,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
): number[] {
  const hits: number[] = [];
  walls.forEach((seg, i) => {
    if (segmentIntersectsWorldRect(seg, map, rx, ry, rw, rh)) hits.push(i);
  });
  return hits;
}

export function removeWallIndices(map: MapItem, indices: number[]): WallSegment[] {
  const remove = new Set(indices);
  return (map.walls ?? []).filter((_, i) => !remove.has(i));
}

export function eraseNearestWallSegment(map: MapItem, localX: number, localY: number): boolean {
  const walls = map.walls ?? [];
  const idx = nearestWallIndex(localX, localY, walls);
  if (idx < 0) return false;
  const next = walls.filter((_, i) => i !== idx);
  return next.length !== walls.length;
}
