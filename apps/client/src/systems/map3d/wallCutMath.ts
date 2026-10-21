import type { WallCut, WallPoint, WallSegment } from '@/systems/scene/types';

export type SurfPt = { along: number; height: number };

const MIN_KEEP = 3;

export function parseSurfPoints(points: number[]): SurfPt[] {
  const out: SurfPt[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({ along: points[i]!, height: points[i + 1]! });
  }
  return out;
}

export function wallLen(a: WallPoint, b: WallPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function sameWallLine(a: WallPoint, b: WallPoint, c: WallPoint, d: WallPoint, eps = 6): boolean {
  // Collinear-ish: both endpoints of CD near line AB (or swapped).
  const len = wallLen(a, b) || 1;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const dist = (p: WallPoint) => Math.abs((p.x - a.x) * -uy + (p.y - a.y) * ux);
  return dist(c) <= eps && dist(d) <= eps;
}

/** Project map-local point onto wall AB → along distance from A. */
export function alongOnWall(a: WallPoint, b: WallPoint, p: WallPoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
}

/**
 * Thicken an open polyline into a simple polygon (left offset + reversed right).
 * `half` is half brush width in surface units.
 */
export function strokeToHolePolygon(pts: SurfPt[], half: number): SurfPt[] {
  if (pts.length < 2 || half <= 0) return pts.map((p) => ({ ...p }));
  const left: SurfPt[] = [];
  const right: SurfPt[] = [];

  for (let i = 0; i < pts.length; i++) {
    const prev = pts[Math.max(0, i - 1)]!;
    const cur = pts[i]!;
    const next = pts[Math.min(pts.length - 1, i + 1)]!;
    let tx = next.along - prev.along;
    let ty = next.height - prev.height;
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl;
    ty /= tl;
    const nx = -ty;
    const ny = tx;
    left.push({ along: cur.along + nx * half, height: cur.height + ny * half });
    right.push({ along: cur.along - nx * half, height: cur.height - ny * half });
  }
  return [...left, ...right.reverse()];
}

export function isClosedStroke(pts: SurfPt[], closeDist: number): boolean {
  if (pts.length < 3) return false;
  const a = pts[0]!;
  const b = pts[pts.length - 1]!;
  return Math.hypot(a.along - b.along, a.height - b.height) <= closeDist;
}

/** Build a circle polygon in wall surface space (along, height). */
export function circleSurfPolygon(
  centerAlong: number,
  centerHeight: number,
  radius: number,
  segments = 32,
): SurfPt[] {
  const r = Math.max(2, radius);
  const out: SurfPt[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    out.push({
      along: centerAlong + Math.cos(t) * r,
      height: centerHeight + Math.sin(t) * r,
    });
  }
  return out;
}

/** Build the hole polygon for a cut (closed fill or thickened stroke). */
export function cutHolePolygon(cut: WallCut): SurfPt[] {
  const pts = parseSurfPoints(cut.points);
  if (pts.length < 2) return [];
  if (cut.closed || isClosedStroke(pts, Math.max(cut.stroke * 1.5, 8))) {
    // Ensure hole winding is opposite to outer CCW rectangle (clockwise).
    return ensureClockwise(pts);
  }
  return ensureClockwise(strokeToHolePolygon(pts, Math.max(2, cut.stroke * 0.5)));
}

function ensureClockwise(pts: SurfPt[]): SurfPt[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a.along * b.height - b.along * a.height;
  }
  // Positive area = CCW in (along, height); holes should be CW.
  return area > 0 ? [...pts].reverse() : pts;
}

/** Point-in-polygon (ray cast) in surface space. */
export function pointInPoly(along: number, height: number, poly: SurfPt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i]!;
    const pj = poly[j]!;
    const intersect =
      (pi.height > height) !== (pj.height > height)
      && along < ((pj.along - pi.along) * (height - pi.height)) / ((pj.height - pi.height) || 1e-9) + pi.along;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type AlongInterval = { t0: number; t1: number };

/**
 * Along-intervals where the hole opens near the floor (walk / LOS punch).
 * Samples the cut along its span and keeps columns that cover [0, walkHeight].
 */
export function floorOpenIntervals(
  cut: WallCut,
  walkHeight: number,
  step = 4,
): AlongInterval[] {
  const poly = cutHolePolygon(cut);
  if (poly.length < 3) return [];

  let minA = Infinity;
  let maxA = -Infinity;
  for (const p of poly) {
    minA = Math.min(minA, p.along);
    maxA = Math.max(maxA, p.along);
  }
  if (!Number.isFinite(minA) || maxA - minA < 1) return [];

  const open: boolean[] = [];
  const cols: number[] = [];
  for (let a = minA; a <= maxA + step * 0.5; a += step) {
    cols.push(a);
    let coversFloor = false;
    for (let h = 0; h <= walkHeight; h += Math.max(2, walkHeight / 6)) {
      if (pointInPoly(a, h, poly)) {
        coversFloor = true;
        break;
      }
    }
    open.push(coversFloor);
  }

  const intervals: AlongInterval[] = [];
  let start: number | null = null;
  for (let i = 0; i < open.length; i++) {
    if (open[i] && start === null) start = cols[i]!;
    if ((!open[i] || i === open.length - 1) && start !== null) {
      const end = open[i] && i === open.length - 1 ? cols[i]! : cols[Math.max(0, i - 1)]!;
      intervals.push({ t0: start - step * 0.5, t1: end + step * 0.5 });
      start = null;
    }
  }
  return mergeIntervals(intervals);
}

function mergeIntervals(intervals: AlongInterval[]): AlongInterval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.t0 - b.t0);
  const out: AlongInterval[] = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = out[out.length - 1]!;
    if (cur.t0 <= last.t1 + 2) last.t1 = Math.max(last.t1, cur.t1);
    else out.push({ ...cur });
  }
  return out;
}

/** Punch multiple along-gaps from one wall index (highest-level helper). */
export function punchWallIntervals(
  walls: WallSegment[],
  wallIndex: number,
  intervals: AlongInterval[],
): WallSegment[] {
  const wall = walls[wallIndex];
  if (!wall || intervals.length === 0) return walls;

  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy);
  if (len < MIN_KEEP) return walls.filter((_, i) => i !== wallIndex);

  const ux = dx / len;
  const uy = dy / len;
  const clipped = mergeIntervals(
    intervals
      .map((iv) => ({ t0: Math.max(0, iv.t0), t1: Math.min(len, iv.t1) }))
      .filter((iv) => iv.t1 - iv.t0 >= 2),
  );

  if (clipped.length === 0) return walls;

  const pieces: WallSegment[] = [];
  let cursor = 0;
  for (const iv of clipped) {
    if (iv.t0 - cursor > MIN_KEEP) {
      pieces.push({
        a: { x: wall.a.x + ux * cursor, y: wall.a.y + uy * cursor },
        b: { x: wall.a.x + ux * iv.t0, y: wall.a.y + uy * iv.t0 },
      });
    }
    cursor = iv.t1;
  }
  if (len - cursor > MIN_KEEP) {
    pieces.push({
      a: { x: wall.a.x + ux * cursor, y: wall.a.y + uy * cursor },
      b: { x: wall.b.x, y: wall.b.y },
    });
  }

  const next = [...walls];
  next.splice(wallIndex, 1, ...pieces);
  return next;
}

/** Cuts whose wall line matches this segment; hole along shifted into seg-local (from seg.a). */
export function cutsForSegment(seg: WallSegment, cuts: WallCut[]): WallCut[] {
  const out: WallCut[] = [];
  for (const cut of cuts) {
    if (!sameWallLine(cut.wallA, cut.wallB, seg.a, seg.b)) continue;
    const alongA = alongOnWall(cut.wallA, cut.wallB, seg.a);
    const alongB = alongOnWall(cut.wallA, cut.wallB, seg.b);
    const lo = Math.min(alongA, alongB);
    const hi = Math.max(alongA, alongB);
    const pts = parseSurfPoints(cut.points);
    const overlaps = pts.some((p) => p.along >= lo - 4 && p.along <= hi + 4);
    if (!overlaps) continue;
    const reversed = alongB < alongA;
    const shifted: number[] = [];
    for (const p of pts) {
      const localAlong = reversed ? alongA - p.along : p.along - alongA;
      shifted.push(localAlong, p.height);
    }
    out.push({
      ...cut,
      wallA: { ...seg.a },
      wallB: { ...seg.b },
      points: shifted,
    });
  }
  return out;
}
