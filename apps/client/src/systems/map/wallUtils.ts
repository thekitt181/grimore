import type { MapItem, WallSegment } from '@/systems/scene/types';

/** Fine brush — splits segments instead of deleting whole lines. */
export const WALL_ERASE_RADIUS = 7;
export const MIN_WALL_SEGMENT_LEN = 4;
export const WALL_ENDPOINT_HIT_PX = 10;
export const WALL_ENDPOINT_JOIN_PX = 3;

export type WallEndpoint = 'a' | 'b';

export type WallHandleHit = {
  wallIndex: number;
  end: WallEndpoint;
};

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

/** Split one segment, removing the portion within `radius` of (px, py). */
export function splitSegmentAtErase(
  seg: WallSegment,
  px: number,
  py: number,
  radius = WALL_ERASE_RADIUS,
): WallSegment[] {
  const ax = seg.a.x;
  const ay = seg.a.y;
  const bx = seg.b.x;
  const by = seg.b.y;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) {
    return Math.hypot(px - ax, py - ay) <= radius ? [] : [seg];
  }
  const len = Math.sqrt(lenSq);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  const dist = Math.hypot(px - qx, py - qy);
  if (dist > radius) return [seg];

  const halfChord = Math.sqrt(Math.max(0, radius * radius - dist * dist)) / len;
  let t1 = Math.max(0, t - halfChord);
  let t2 = Math.min(1, t + halfChord);
  if (t2 - t1 >= 0.999) return [];

  const parts: WallSegment[] = [];
  if (t1 > 1e-4) {
    const p2 = { x: ax + t1 * dx, y: ay + t1 * dy };
    if (Math.hypot(p2.x - ax, p2.y - ay) >= MIN_WALL_SEGMENT_LEN) parts.push({ a: { x: ax, y: ay }, b: p2 });
  }
  if (t2 < 1 - 1e-4) {
    const p1 = { x: ax + t2 * dx, y: ay + t2 * dy };
    if (Math.hypot(bx - p1.x, by - p1.y) >= MIN_WALL_SEGMENT_LEN) parts.push({ a: p1, b: { x: bx, y: by } });
  }
  return parts;
}

/** Erase a fine brush stroke at map-local coordinates. */
export function eraseWallsAtPoint(
  walls: WallSegment[],
  localX: number,
  localY: number,
  radius = WALL_ERASE_RADIUS,
): WallSegment[] {
  const out: WallSegment[] = [];
  for (const seg of walls) {
    out.push(...splitSegmentAtErase(seg, localX, localY, radius));
  }
  return out;
}

export function translateWallIndices(
  walls: WallSegment[],
  indices: ReadonlySet<number> | number[],
  dx: number,
  dy: number,
): WallSegment[] {
  const set = indices instanceof Set ? indices : new Set(indices);
  return walls.map((w, i) => {
    if (!set.has(i)) return w;
    return {
      a: { x: w.a.x + dx, y: w.a.y + dy },
      b: { x: w.b.x + dx, y: w.b.y + dy },
    };
  });
}

export function moveWallEndpoint(
  walls: WallSegment[],
  wallIndex: number,
  end: WallEndpoint,
  newLocal: { x: number; y: number },
  selectedIndices: ReadonlySet<number> | number[],
  joinPx = WALL_ENDPOINT_JOIN_PX,
): WallSegment[] {
  const sel = selectedIndices instanceof Set ? selectedIndices : new Set(selectedIndices);
  const anchor = walls[wallIndex]?.[end];
  if (!anchor) return walls;

  return walls.map((w, i) => {
    if (!sel.has(i) && i !== wallIndex) return w;
    const next = { a: { ...w.a }, b: { ...w.b } };
    if (Math.hypot(w.a.x - anchor.x, w.a.y - anchor.y) <= joinPx) {
      next.a.x = newLocal.x;
      next.a.y = newLocal.y;
    }
    if (Math.hypot(w.b.x - anchor.x, w.b.y - anchor.y) <= joinPx) {
      next.b.x = newLocal.x;
      next.b.y = newLocal.y;
    }
    const len = Math.hypot(next.b.x - next.a.x, next.b.y - next.a.y);
    if (len < MIN_WALL_SEGMENT_LEN) return w;
    return next;
  });
}

export function wallHandleWorldPoints(
  map: MapItem,
  selectedIndices: number[],
): Array<WallHandleHit & { wx: number; wy: number }> {
  const handles: Array<WallHandleHit & { wx: number; wy: number }> = [];
  const walls = map.walls ?? [];
  for (const i of selectedIndices) {
    const seg = walls[i];
    if (!seg) continue;
    handles.push(
      { wallIndex: i, end: 'a', wx: map.x + seg.a.x, wy: map.y + seg.a.y },
      { wallIndex: i, end: 'b', wx: map.x + seg.b.x, wy: map.y + seg.b.y },
    );
  }
  return handles;
}

export function pickWallHandle(
  wx: number,
  wy: number,
  handles: Array<WallHandleHit & { wx: number; wy: number }>,
  scale: number,
): WallHandleHit | null {
  const tol = WALL_ENDPOINT_HIT_PX / Math.max(scale, 0.05);
  let best: WallHandleHit | null = null;
  let bestD = tol * tol;
  for (const h of handles) {
    const d = (wx - h.wx) ** 2 + (wy - h.wy) ** 2;
    if (d <= bestD) {
      bestD = d;
      best = { wallIndex: h.wallIndex, end: h.end };
    }
  }
  return best;
}

export function wallsChanged(a: WallSegment[], b: WallSegment[]): boolean {
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.a.x !== y.a.x || x.a.y !== y.a.y || x.b.x !== y.b.x || x.b.y !== y.b.y) return true;
  }
  return false;
}
