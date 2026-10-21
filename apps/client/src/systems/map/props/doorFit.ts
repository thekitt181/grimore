/**
 * Auto-size / snap doors & gates into corridor openings and wall gaps.
 *
 * Priority:
 * 1) Between parallel walls (corridor / passage width)
 * 2) Collinear gap in a wall run (doorway punched in a long wall)
 * 3) Short wall span (closed door seal)
 */
import type { ImageItem, MapItem, WallSegment } from '@/systems/scene/types';
import { isDoorPropId } from './doorCollision';
import { resolvePropId } from './dungeonProps';
import { canonicalPropId } from './propArt';

export type DoorFitPose = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
};

type LineGroup = {
  ux: number;
  uy: number;
  offset: number;
  spans: Array<{ t0: number; t1: number }>;
};

type FitCandidate = {
  localCx: number;
  localCy: number;
  /** Span across the opening (long axis of the panel). */
  along: number;
  /** Thickness through the wall. */
  across: number;
  /** Degrees — long axis of the prop in map-local space. */
  rotationDeg: number;
  dist: number;
  kind: 'corridor' | 'gap' | 'wall';
};

function wallHalfThickness(map: MapItem): number {
  return Math.max(4, map.gridSize * 0.12) * 0.5;
}

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

function lineKey(ux: number, uy: number, offset: number, cell: number): string {
  let ax = ux;
  let ay = uy;
  if (ax < -1e-6 || (Math.abs(ax) < 1e-6 && ay < 0)) {
    ax = -ax;
    ay = -ay;
  }
  const ang = Math.round((Math.atan2(ay, ax) * 180) / Math.PI / 2) * 2;
  const off = Math.round(offset / Math.max(2, cell * 0.08));
  return `${ang}:${off}`;
}

function buildLineGroups(walls: WallSegment[], cell: number): LineGroup[] {
  const buckets = new Map<string, LineGroup>();
  for (const wall of walls) {
    const abx = wall.b.x - wall.a.x;
    const aby = wall.b.y - wall.a.y;
    const len = Math.hypot(abx, aby);
    if (len < 2) continue;
    let ux = abx / len;
    let uy = aby / len;
    if (ux < -1e-6 || (Math.abs(ux) < 1e-6 && uy < 0)) {
      ux = -ux;
      uy = -uy;
    }
    const nx = -uy;
    const ny = ux;
    const offset = wall.a.x * nx + wall.a.y * ny;
    const key = lineKey(ux, uy, offset, cell);
    let g = buckets.get(key);
    if (!g) {
      g = { ux, uy, offset, spans: [] };
      buckets.set(key, g);
    }
    const t0 = wall.a.x * ux + wall.a.y * uy;
    const t1 = wall.b.x * ux + wall.b.y * uy;
    g.spans.push({ t0: Math.min(t0, t1), t1: Math.max(t0, t1) });
  }

  for (const g of buckets.values()) {
    g.spans.sort((a, b) => a.t0 - b.t0);
    const merged: Array<{ t0: number; t1: number }> = [];
    for (const s of g.spans) {
      const last = merged[merged.length - 1];
      // Merge only touching / tiny seams — never swallow a real doorway.
      if (last && s.t0 <= last.t1 + Math.max(2, cell * 0.02)) {
        last.t1 = Math.max(last.t1, s.t1);
      } else {
        merged.push({ ...s });
      }
    }
    g.spans = merged;
  }
  return [...buckets.values()];
}

function spanCovers(g: LineGroup, t: number, pad: number): boolean {
  return g.spans.some((s) => t >= s.t0 - pad && t <= s.t1 + pad);
}

function sameDirection(a: LineGroup, b: LineGroup): boolean {
  return Math.abs(a.ux * b.ux + a.uy * b.uy) > 0.98;
}

function panelDepth(map: MapItem): number {
  const cell = Math.max(8, map.gridSize);
  // Keep depth chunky enough that 3D / 2D art stays readable (not a hairline).
  return Math.max(cell * 0.5, wallHalfThickness(map) * 3);
}

function candidatesNear(map: MapItem, localX: number, localY: number): FitCandidate[] {
  const cell = Math.max(8, map.gridSize);
  const walls = map.walls ?? [];
  if (!walls.length) return [];

  const groups = buildLineGroups(walls, cell);
  const out: FitCandidate[] = [];
  const half = wallHalfThickness(map);
  const depth = panelDepth(map);
  const minOpen = cell * 0.4;
  const maxOpen = cell * 4.2;

  // ── 1) Corridor: probe between a pair of parallel walls ───────────────────
  for (let i = 0; i < groups.length; i++) {
    const a = groups[i]!;
    for (let j = i + 1; j < groups.length; j++) {
      const b = groups[j]!;
      if (!sameDirection(a, b)) continue;
      const sep = Math.abs(a.offset - b.offset);
      if (sep < minOpen || sep > maxOpen) continue;

      const ux = a.ux;
      const uy = a.uy;
      const nx = -uy;
      const ny = ux;
      const tProbe = localX * ux + localY * uy;
      const nProbe = localX * nx + localY * ny;
      const oMin = Math.min(a.offset, b.offset);
      const oMax = Math.max(a.offset, b.offset);
      // Must sit in the passage between the two centerlines.
      if (nProbe < oMin + half * 0.25 || nProbe > oMax - half * 0.25) continue;
      const coverPad = cell * 0.15;
      if (!spanCovers(a, tProbe, coverPad) || !spanCovers(b, tProbe, coverPad)) continue;

      // Inner clear width (centerline sep minus wall half-thickness each side).
      const clear = Math.max(minOpen, sep - half * 2);
      // Slight inset so the panel sits inside the jambs, not past into void.
      const along = Math.max(minOpen, clear * 0.92);
      const midOff = (oMin + oMax) / 2;
      const dist = Math.abs(nProbe - midOff);
      out.push({
        localCx: ux * tProbe + nx * midOff,
        localCy: uy * tProbe + ny * midOff,
        along,
        across: depth,
        // Long axis across the corridor (= wall normal).
        rotationDeg: (Math.atan2(ny, nx) * 180) / Math.PI,
        dist,
        kind: 'corridor',
      });
    }
  }

  // ── 2) Collinear doorway gaps + 3) short wall seals ───────────────────────
  for (const g of groups) {
    const { ux, uy, offset } = g;
    const nx = -uy;
    const ny = ux;
    const tProbe = localX * ux + localY * uy;
    const nProbe = localX * nx + localY * ny;
    const nDist = Math.abs(nProbe - offset);
    if (nDist > cell * 0.75) continue;

    for (let i = 0; i < g.spans.length - 1; i++) {
      const s0 = g.spans[i]!;
      const s1 = g.spans[i + 1]!;
      const gap = s1.t0 - s0.t1;
      if (gap < minOpen || gap > maxOpen) continue;
      const tMid = (s0.t1 + s1.t0) / 2;
      const alongDist = Math.abs(tProbe - tMid);
      if (alongDist > gap * 0.6 + cell * 0.25) continue;
      out.push({
        localCx: ux * tMid + nx * offset,
        localCy: uy * tMid + ny * offset,
        along: Math.max(minOpen, gap * 0.92),
        across: depth,
        rotationDeg: (Math.atan2(uy, ux) * 180) / Math.PI,
        dist: Math.hypot(nDist, alongDist * 0.4) + 0.5,
        kind: 'gap',
      });
    }

    for (const s of g.spans) {
      const spanLen = s.t1 - s.t0;
      if (spanLen < minOpen * 0.5 || spanLen > cell * 1.4) continue;
      const tClamped = Math.max(s.t0, Math.min(s.t1, tProbe));
      const alongDist = Math.abs(tProbe - tClamped);
      if (alongDist > cell * 0.35) continue;
      out.push({
        localCx: ux * tClamped + nx * offset,
        localCy: uy * tClamped + ny * offset,
        along: Math.max(minOpen, spanLen * 0.96),
        across: depth,
        rotationDeg: (Math.atan2(uy, ux) * 180) / Math.PI,
        dist: Math.hypot(nDist, alongDist) + 1,
        kind: 'wall',
      });
    }
  }

  return out;
}

function kindRank(k: FitCandidate['kind']): number {
  if (k === 'corridor') return 0;
  if (k === 'gap') return 1;
  return 2;
}

function poseFromCandidate(map: MapItem, c: FitCandidate): DoorFitPose {
  const world = worldFromMapLocal(c.localCx, c.localCy, map);
  const rotation = c.rotationDeg + map.rotation;
  return {
    x: world.x - c.along / 2,
    y: world.y - c.across / 2,
    width: c.along,
    height: c.across,
    rotation,
  };
}

function pickBest(cands: FitCandidate[], maxDist: number): FitCandidate | null {
  if (!cands.length) return null;
  cands.sort((a, b) => {
    const kr = kindRank(a.kind) - kindRank(b.kind);
    if (kr !== 0) return kr;
    return a.dist - b.dist;
  });
  const best = cands[0]!;
  if (best.dist > maxDist) return null;
  return best;
}

/** Best door/gate fit near a world point, or null if nothing is close enough. */
export function fitDoorOrGateNearPoint(
  map: MapItem,
  worldX: number,
  worldY: number,
  _propId?: string,
): DoorFitPose | null {
  const local = mapLocalFromWorld(worldX, worldY, map);
  const best = pickBest(candidatesNear(map, local.x, local.y), map.gridSize * 0.9);
  return best ? poseFromCandidate(map, best) : null;
}

/** Apply fit onto an existing door/gate image. */
export function fitDoorOrGateItem(item: ImageItem, map: MapItem): DoorFitPose | null {
  const propId = resolvePropId(item);
  if (!isDoorPropId(propId)) return null;
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  return fitDoorOrGateNearPoint(map, cx, cy, propId);
}

/**
 * Nearest opening on the map (fresh place). Tries local fit first, then
 * nearest corridor/gap anywhere.
 */
export function fitDoorOrGateOnMap(
  map: MapItem,
  nearWorldX: number,
  nearWorldY: number,
  propId?: string,
): DoorFitPose | null {
  const direct = fitDoorOrGateNearPoint(map, nearWorldX, nearWorldY, propId);
  if (direct) return direct;

  const local = mapLocalFromWorld(nearWorldX, nearWorldY, map);
  const cell = Math.max(8, map.gridSize);
  // Search with a looser distance by evaluating every corridor/gap candidate
  // from a synthetic probe — reuse candidatesNear at many samples is heavy;
  // instead scan all corridor pairs + gaps with distance-to-point ranking.
  const groups = buildLineGroups(map.walls ?? [], cell);
  const half = wallHalfThickness(map);
  const depth = panelDepth(map);
  const minOpen = cell * 0.4;
  const maxOpen = cell * 4.2;
  const cands: FitCandidate[] = [];

  for (let i = 0; i < groups.length; i++) {
    const a = groups[i]!;
    for (let j = i + 1; j < groups.length; j++) {
      const b = groups[j]!;
      if (!sameDirection(a, b)) continue;
      const sep = Math.abs(a.offset - b.offset);
      if (sep < minOpen || sep > maxOpen) continue;
      const ux = a.ux;
      const uy = a.uy;
      const nx = -uy;
      const ny = ux;
      const oMin = Math.min(a.offset, b.offset);
      const oMax = Math.max(a.offset, b.offset);
      const midOff = (oMin + oMax) / 2;
      // Sample midpoints of overlapping span ranges.
      for (const sa of a.spans) {
        for (const sb of b.spans) {
          const t0 = Math.max(sa.t0, sb.t0);
          const t1 = Math.min(sa.t1, sb.t1);
          if (t1 - t0 < minOpen * 0.5) continue;
          const tMid = (t0 + t1) / 2;
          const lx = ux * tMid + nx * midOff;
          const ly = uy * tMid + ny * midOff;
          const clear = Math.max(minOpen, sep - half * 2);
          cands.push({
            localCx: lx,
            localCy: ly,
            along: Math.max(minOpen, clear * 0.92),
            across: depth,
            rotationDeg: (Math.atan2(ny, nx) * 180) / Math.PI,
            dist: Math.hypot(lx - local.x, ly - local.y),
            kind: 'corridor',
          });
        }
      }
    }
  }

  for (const g of groups) {
    const { ux, uy, offset } = g;
    const nx = -uy;
    const ny = ux;
    for (let i = 0; i < g.spans.length - 1; i++) {
      const s0 = g.spans[i]!;
      const s1 = g.spans[i + 1]!;
      const gap = s1.t0 - s0.t1;
      if (gap < minOpen || gap > maxOpen) continue;
      const tMid = (s0.t1 + s1.t0) / 2;
      const lx = ux * tMid + nx * offset;
      const ly = uy * tMid + ny * offset;
      cands.push({
        localCx: lx,
        localCy: ly,
        along: Math.max(minOpen, gap * 0.92),
        across: depth,
        rotationDeg: (Math.atan2(uy, ux) * 180) / Math.PI,
        dist: Math.hypot(lx - local.x, ly - local.y) + 0.5,
        kind: 'gap',
      });
    }
  }

  void propId;
  void canonicalPropId;
  const best = pickBest(cands, Number.POSITIVE_INFINITY);
  return best ? poseFromCandidate(map, best) : null;
}
