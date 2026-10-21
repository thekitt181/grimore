import { v4 as uuidv4 } from 'uuid';
import type { MapBreachFx, MapItem, WallCut, WallSegment } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { useSessionStore } from '@/store/sessionStore';
import { useFirstPersonStore } from './firstPersonStore';
import { raycastFpSurface, type FpWallHit } from './fpSurfaceRaycast';
import {
  circleSurfPolygon,
  floorOpenIntervals,
  isClosedStroke,
  parseSurfPoints,
  punchWallIntervals,
  sameWallLine,
  wallLen,
} from './wallCutMath';
import { pushFpBreachUndo } from './fpPaintUndo';
import type * as THREE from 'three';

function findWallIndex(
  walls: WallSegment[],
  wallA: { x: number; y: number },
  wallB: { x: number; y: number },
  hint: number,
): number {
  const exact = walls.findIndex(
    (w) =>
      (Math.abs(w.a.x - wallA.x) < 0.5 && Math.abs(w.a.y - wallA.y) < 0.5
        && Math.abs(w.b.x - wallB.x) < 0.5 && Math.abs(w.b.y - wallB.y) < 0.5)
      || (Math.abs(w.a.x - wallB.x) < 0.5 && Math.abs(w.a.y - wallB.y) < 0.5
        && Math.abs(w.b.x - wallA.x) < 0.5 && Math.abs(w.b.y - wallA.y) < 0.5),
  );
  if (exact >= 0) return exact;
  if (hint >= 0 && hint < walls.length && sameWallLine(wallA, wallB, walls[hint]!.a, walls[hint]!.b)) {
    return hint;
  }
  let best = -1;
  let bestLen = 0;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!;
    if (!sameWallLine(wallA, wallB, w.a, w.b)) continue;
    const len = wallLen(w.a, w.b);
    if (len > bestLen) {
      bestLen = len;
      best = i;
    }
  }
  return best;
}

export type FpBreachPreview = {
  shape: 'freehand' | 'circle';
  mapId: string;
  wallIndex: number;
  wallA: { x: number; y: number };
  wallB: { x: number; y: number };
  stroke: number;
  /** World [x,y,z,...] freehand path or circle outline. */
  worldPts: number[];
  /** Surface [along, height, ...]. */
  surfacePts: number[];
  /** Circle center in surface space. */
  centerAlong?: number;
  centerHeight?: number;
  radius?: number;
  /** World-space center for ghost mesh. */
  centerWorld?: { x: number; y: number; z: number };
  nx?: number;
  nz?: number;
};

let breaching = false;
let preview: FpBreachPreview | null = null;
let lastSampleAt = 0;
const SAMPLE_MS = 20;
const MIN_DIST = 2;

const listeners = new Set<() => void>();

export function getFpBreachPreview(): FpBreachPreview | null {
  return preview;
}

export function subscribeFpBreachPreview(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) cb();
}

function worldOnWall(
  hit: Pick<FpWallHit, 'wallA' | 'wallB' | 'along' | 'height' | 'nx' | 'nz' | 'worldX' | 'worldY' | 'worldZ'>,
  mapX: number,
  mapY: number,
  along: number,
  height: number,
): { x: number; y: number; z: number } {
  const dx = hit.wallB.x - hit.wallA.x;
  const dy = hit.wallB.y - hit.wallA.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  // Reuse the face offset from the live hit so the ghost sits on the same surface.
  const midHitX = mapX + hit.wallA.x + ux * hit.along;
  const midHitZ = mapY + hit.wallA.y + uy * hit.along;
  const faceOx = hit.worldX - midHitX;
  const faceOz = hit.worldZ - midHitZ;
  return {
    x: mapX + hit.wallA.x + ux * along + faceOx,
    y: height,
    z: mapY + hit.wallA.y + uy * along + faceOz,
  };
}

function setCirclePreview(hit: FpWallHit, centerAlong: number, centerHeight: number, radius: number) {
  if (!preview) return;
  const map = useItemStore.getState().items[preview.mapId];
  const mapX = map && map.type === 'map' ? map.x : 0;
  const mapY = map && map.type === 'map' ? map.y : 0;
  const poly = circleSurfPolygon(centerAlong, centerHeight, radius, 40);
  const worldPts: number[] = [];
  const surfacePts: number[] = [];
  for (const p of poly) {
    surfacePts.push(p.along, p.height);
    const w = worldOnWall(hit, mapX, mapY, p.along, p.height);
    worldPts.push(w.x, w.y, w.z);
  }
  // Close loop for Line preview.
  if (poly[0]) {
    const w0 = worldOnWall(hit, mapX, mapY, poly[0].along, poly[0].height);
    worldPts.push(w0.x, w0.y, w0.z);
  }
  preview.surfacePts = surfacePts;
  preview.worldPts = worldPts;
  preview.centerAlong = centerAlong;
  preview.centerHeight = centerHeight;
  preview.radius = radius;
  preview.centerWorld = worldOnWall(hit, mapX, mapY, centerAlong, centerHeight);
  preview.nx = hit.nx;
  preview.nz = hit.nz;
  notify();
}

function appendFreehand(hit: FpWallHit) {
  if (!preview) return;
  if (preview.mapId !== hit.mapId) return;
  if (preview.wallIndex !== hit.wallIndex) return;

  const n = preview.worldPts.length;
  if (n >= 3) {
    const dx = hit.worldX - preview.worldPts[n - 3]!;
    const dy = hit.worldY - preview.worldPts[n - 2]!;
    const dz = hit.worldZ - preview.worldPts[n - 1]!;
    if (Math.hypot(dx, dy, dz) < MIN_DIST) return;
  }
  preview.worldPts.push(hit.worldX, hit.worldY, hit.worldZ);
  preview.surfacePts.push(hit.along, hit.height);
  notify();
}

export function beginFpBreach(scene: THREE.Scene | null): void {
  if (breaching) return;
  if (useSessionStore.getState().myRole !== 'GM') return;
  if (useFirstPersonStore.getState().tool !== 'breach') return;
  const hit = raycastFpSurface(scene);
  if (!hit || hit.surface !== 'wall') return;

  const brush = useFirstPersonStore.getState().brushSize;
  const shape = useFirstPersonStore.getState().drawShape;
  breaching = true;
  lastSampleAt = performance.now();
  preview = {
    shape,
    mapId: hit.mapId,
    wallIndex: hit.wallIndex,
    wallA: { ...hit.wallA },
    wallB: { ...hit.wallB },
    stroke: Math.max(6, brush),
    worldPts: [],
    surfacePts: [],
    nx: hit.nx,
    nz: hit.nz,
  };

  if (shape === 'circle') {
    // Start with brush radius so a click-stamp is already a visible circle.
    setCirclePreview(hit, hit.along, hit.height, Math.max(8, brush * 1.25));
  } else {
    appendFreehand(hit);
  }
}

export function sampleFpBreach(scene: THREE.Scene | null): void {
  if (!breaching || !preview) return;
  const now = performance.now();
  if (now - lastSampleAt < SAMPLE_MS) return;
  lastSampleAt = now;
  const hit = raycastFpSurface(scene);
  if (!hit || hit.surface !== 'wall') return;
  if (hit.mapId !== preview.mapId || hit.wallIndex !== preview.wallIndex) return;

  if (preview.shape === 'circle') {
    const cAlong = preview.centerAlong ?? hit.along;
    const cH = preview.centerHeight ?? hit.height;
    const radius = Math.max(6, Math.hypot(hit.along - cAlong, hit.height - cH));
    setCirclePreview(hit, cAlong, cH, radius);
    return;
  }
  appendFreehand(hit);
}

export function endFpBreach(): void {
  if (!breaching) return;
  breaching = false;
  const stroke = preview;
  preview = null;
  notify();
  if (!stroke || stroke.surfacePts.length < 6) return;
  commitBreachShape(stroke);
}

function commitBreachShape(stroke: FpBreachPreview): void {
  if (useSessionStore.getState().myRole !== 'GM') return;

  const map = useItemStore.getState().items[stroke.mapId];
  if (!map || map.type !== 'map') return;

  let surfacePts = [...stroke.surfacePts];
  let closed = stroke.shape === 'circle';

  if (stroke.shape === 'circle' && stroke.centerAlong != null && stroke.centerHeight != null) {
    const r = Math.max(6, stroke.radius ?? stroke.stroke);
    const poly = circleSurfPolygon(stroke.centerAlong, stroke.centerHeight, r, 40);
    surfacePts = [];
    for (const p of poly) surfacePts.push(p.along, p.height);
    closed = true;
  } else {
    const surf = parseSurfPoints(surfacePts);
    closed = isClosedStroke(surf, Math.max(stroke.stroke * 1.5, 10));
  }

  const cut: WallCut = {
    id: uuidv4(),
    wallA: { ...stroke.wallA },
    wallB: { ...stroke.wallB },
    points: surfacePts,
    stroke: stroke.stroke,
    ...(closed ? { closed: true } : {}),
  };

  const walkH = Math.max(12, (map.gridSize || 96) * 0.45);
  // Punch walk/LOS wherever the hole opens near the floor; for tall circles also
  // punch the along-span so the gap is walkable when it reaches the ground.
  let floorGaps = floorOpenIntervals(cut, walkH);
  if (floorGaps.length === 0 && closed) {
    // Mid-wall window: still punch a narrow along gap if the hole is large
    // enough vertically that it clearly opens the wall (breach intent).
    let minA = Infinity;
    let maxA = -Infinity;
    let minH = Infinity;
    let maxH = -Infinity;
    const pts = parseSurfPoints(surfacePts);
    for (const p of pts) {
      minA = Math.min(minA, p.along);
      maxA = Math.max(maxA, p.along);
      minH = Math.min(minH, p.height);
      maxH = Math.max(maxH, p.height);
    }
    if (minH <= walkH && maxA - minA > 4) {
      floorGaps = [{ t0: minA, t1: maxA }];
    }
  }

  let walls = [...(map.walls ?? [])];
  const wallIdx = findWallIndex(walls, stroke.wallA, stroke.wallB, stroke.wallIndex);
  if (floorGaps.length > 0 && wallIdx >= 0) {
    walls = punchWallIntervals(walls, wallIdx, floorGaps);
  }

  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  const n = stroke.worldPts.length / 3;
  for (let i = 0; i + 2 < stroke.worldPts.length; i += 3) {
    sumX += stroke.worldPts[i]!;
    sumY += stroke.worldPts[i + 1]!;
    sumZ += stroke.worldPts[i + 2]!;
  }
  const dx = stroke.wallB.x - stroke.wallA.x;
  const dy = stroke.wallB.y - stroke.wallA.y;
  const len = Math.hypot(dx, dy) || 1;

  const breachFx: MapBreachFx = {
    id: uuidv4(),
    x: stroke.centerWorld?.x ?? (n > 0 ? sumX / n : 0),
    y: stroke.centerWorld?.y ?? (n > 0 ? sumY / n : walkH),
    z: stroke.centerWorld?.z ?? (n > 0 ? sumZ / n : 0),
    nx: stroke.nx ?? -dy / len,
    nz: stroke.nz ?? dx / len,
  };

  // Snapshot pre-breach walls/cuts before writing the punch.
  pushFpBreachUndo(map);

  const wallCuts = [...(map.wallCuts ?? []), cut];
  const patch: Partial<MapItem> = { walls, wallCuts, breachFx };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);
}

export function isFpBreaching(): boolean {
  return breaching;
}

export function cancelFpBreach(): void {
  breaching = false;
  preview = null;
  notify();
}
