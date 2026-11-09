/**
 * Baked 2D collision + ground height from map GLB/STL.
 * Rays run once (chunked) at load — FP queries are O(1) like dungeon walls.
 * Step risers stay walkable; only real walls / cliffs block.
 */
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import {
  isModularGate,
  isModularMap,
  isModularWall,
  pieceForUrl,
} from '@/systems/map/library/modularKits';
import { pixiToThreeX, pixiToThreeZ } from './coords';

const MISS = Number.NEGATIVE_INFINITY;
/** Eye / torso height above floor (cells). */
const TORSO_CELLS = 0.42;
/** Floor lip / stair tread only — not wall height. KayKit slabs are ~0.3–0.6 m. */
export const MAX_STEP_CELLS = 0.62;
/** Hard cliff — block anything taller. */
const MAX_CLIFF_CELLS = 1.35;
const CELLS_PER_IDLE = 280;

export type MapCollisionGrid = {
  mapId: string;
  originX: number;
  originZ: number;
  cell: number;
  cols: number;
  rows: number;
  /** 1 = has floor under cell. */
  walkable: Uint8Array;
  /** 1 = solid wall (not a climbable step). */
  blocked: Uint8Array;
  /** Ground Y, or MISS. */
  height: Float32Array;
  ready: boolean;
  gridSize: number;
};

type BakeJob = {
  mapId: string;
  map: MapItem;
  root: THREE.Object3D;
  grid: MapCollisionGrid;
  next: number;
  torsoLift: number;
  maxStep: number;
  wallSolid: boolean;
  gateOpen: boolean;
  timer: ReturnType<typeof setTimeout> | null;
};

function wallLocal(map: MapItem, worldX: number, worldZ: number): { lx: number; ly: number } {
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = worldX - cx;
  const dy = worldZ - cy;
  return {
    lx: dx * Math.cos(rad) - dy * Math.sin(rad),
    ly: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** True when the cell sits on the wall slab (not the empty AABB corners). */
function onWallCenterline(map: MapItem, worldX: number, worldZ: number): boolean {
  const { lx, ly } = wallLocal(map, worldX, worldZ);
  const thick = Math.min(map.width, map.height);
  const half = Math.max(14, thick * 0.46);
  if (map.width <= map.height) return Math.abs(lx) <= half;
  return Math.abs(ly) <= half;
}

/** Passage through a Kenney/KayKit gate (center of the long axis). */
function inGateOpening(map: MapItem, worldX: number, worldZ: number): boolean {
  if (!isModularGate(map)) return false;
  const { lx, ly } = wallLocal(map, worldX, worldZ);
  const along = map.width <= map.height ? ly : lx;
  const gs = Math.max(8, map.gridSize);
  return Math.abs(along) <= gs * 1.35;
}

const gridsByMap = new Map<string, MapCollisionGrid>();
const jobsByMap = new Map<string, BakeJob>();

const rayOrigin = new THREE.Vector3();
const rayDirDown = new THREE.Vector3(0, -1, 0);
const rayDirFlat = new THREE.Vector3();
const hitNormal = new THREE.Vector3();
const downCaster = new THREE.Raycaster();
const bandCaster = new THREE.Raycaster();
const flatCaster = new THREE.Raycaster();
downCaster.firstHitOnly = true;
bandCaster.firstHitOnly = false;
flatCaster.firstHitOnly = true;

const CARDINALS: Array<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function sampleDown(root: THREE.Object3D, x: number, z: number): {
  y: number | null;
  ny: number;
} {
  rayOrigin.set(x, 50_000, z);
  downCaster.set(rayOrigin, rayDirDown);
  downCaster.near = 0;
  downCaster.far = 100_000;
  const hits = downCaster.intersectObject(root, true);
  const hit = hits[0];
  if (!hit) return { y: null, ny: 1 };
  let ny = 1;
  if (hit.face) {
    hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
    ny = hitNormal.y;
  }
  return { y: hit.point.y, ny };
}

function hitFaceNy(hit: THREE.Intersection): number {
  if (!hit.face) return 1;
  hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
  return hitNormal.y;
}

/** Lowest floor-like hit below `maxFloorY` — skips doorway lintels and wall caps. */
function sampleFloor(
  root: THREE.Object3D,
  x: number,
  z: number,
  maxFloorY: number,
): { y: number | null; ny: number } {
  rayOrigin.set(x, 50_000, z);
  bandCaster.near = 0;
  bandCaster.far = 100_000;
  bandCaster.set(rayOrigin, rayDirDown);
  const hits = bandCaster.intersectObject(root, true);
  let bestY: number | null = null;
  let bestNy = 1;
  for (const hit of hits) {
    const ny = hitFaceNy(hit);
    if (ny < 0.35) continue;
    if (hit.point.y > maxFloorY) continue;
    if (bestY == null || hit.point.y < bestY) {
      bestY = hit.point.y;
      bestNy = ny;
    }
  }
  return { y: bestY, ny: bestNy };
}

/**
 * True wall (not a stair riser): flat hit with no climbable floor just past it.
 */
function sampleRealWall(
  root: THREE.Object3D,
  x: number,
  z: number,
  floorY: number,
  torsoY: number,
  reach: number,
  maxStep: number,
): boolean {
  flatCaster.near = 0;
  flatCaster.far = reach;
  for (const [dx, dz] of CARDINALS) {
    rayDirFlat.set(dx, 0, dz);
    rayOrigin.set(x, torsoY, z);
    flatCaster.set(rayOrigin, rayDirFlat);
    const hits = flatCaster.intersectObject(root, true);
    const hit = hits[0];
    if (!hit || hit.distance > reach) continue;
    if (hit.face) {
      hitNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      if (hitNormal.y > 0.5) continue; // ramp / floor
    }
    // Peek past the face — stair risers have walkable tread within step height.
    const pastX = x + dx * (hit.distance + reach * 0.55);
    const pastZ = z + dz * (hit.distance + reach * 0.55);
    const past = sampleDown(root, pastX, pastZ);
    if (
      past.y != null
      && past.ny >= 0.35
      && past.y - floorY <= maxStep
      && floorY - past.y <= maxStep * 1.5
    ) {
      continue; // climbable step / ramp
    }
    return true;
  }
  return false;
}

function indexAt(grid: MapCollisionGrid, worldX: number, worldZ: number): number | null {
  const c = Math.floor((worldX - grid.originX) / grid.cell);
  const r = Math.floor((worldZ - grid.originZ) / grid.cell);
  if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
  return r * grid.cols + c;
}

function sampleInteriorPartition(
  root: THREE.Object3D,
  x: number,
  z: number,
  torsoY: number,
  reach: number,
): boolean {
  flatCaster.near = 0;
  flatCaster.far = reach;
  for (const [dx, dz] of CARDINALS) {
    rayDirFlat.set(dx, 0, dz);
    rayOrigin.set(x, torsoY, z);
    flatCaster.set(rayOrigin, rayDirFlat);
    const hits = flatCaster.intersectObject(root, true);
    const hit = hits[0];
    if (!hit || hit.distance > reach) continue;
    if (hitFaceNy(hit) > 0.5) continue;
    return true;
  }
  return false;
}

function bakeCell(job: BakeJob, i: number): void {
  const { grid, root, torsoLift, maxStep, wallSolid, gateOpen, map } = job;
  const c = i % grid.cols;
  const r = Math.floor(i / grid.cols);
  const x = grid.originX + (c + 0.5) * grid.cell;
  const z = grid.originZ + (r + 0.5) * grid.cell;
  const gs = Math.max(8, map.gridSize);
  const torsoY = gs * 1.05;
  const maxFloorY = gs * 1.35;

  if (wallSolid) {
    if (!onWallCenterline(map, x, z)) {
      grid.walkable[i] = 0;
      grid.blocked[i] = 0;
      grid.height[i] = MISS;
      return;
    }
    if (gateOpen && inGateOpening(map, x, z)) {
      grid.walkable[i] = 1;
      grid.blocked[i] = 0;
      grid.height[i] = MISS;
      return;
    }
    grid.walkable[i] = 0;
    grid.blocked[i] = 1;
    grid.height[i] = torsoY;
    return;
  }

  if (isModularMap(map)) {
    const floor = sampleFloor(root, x, z, maxFloorY);
    if (floor.y != null) {
      const kind = pieceForUrl(map.modelUrl)?.kind;
      const partition =
        (kind === 'room' || kind === 'hall')
        && sampleInteriorPartition(
          root,
          x,
          z,
          floor.y + torsoY * 0.55,
          grid.cell * 0.55,
        );
      grid.height[i] = floor.y;
      grid.walkable[i] = partition ? 0 : 1;
      grid.blocked[i] = partition ? 1 : 0;
      return;
    }
    // No floor — wall mass (cap) vs empty box. An open doorway has floor under the lintel.
    const sky = sampleDown(root, x, z);
    grid.walkable[i] = 0;
    grid.blocked[i] = sky.y != null ? 1 : 0;
    grid.height[i] = MISS;
    return;
  }

  const down = sampleDown(root, x, z);
  if (down.y == null || down.ny < 0.28) {
    grid.walkable[i] = 0;
    grid.blocked[i] = down.y == null ? 0 : 1;
    grid.height[i] = MISS;
    return;
  }
  grid.height[i] = down.y;
  grid.walkable[i] = 1;
  const scanTorsoY = down.y + torsoLift;
  const reach = grid.cell * 0.5;
  grid.blocked[i] = sampleRealWall(root, x, z, down.y, scanTorsoY, reach, maxStep) ? 1 : 0;
}

function pumpJob(job: BakeJob): void {
  const total = job.grid.cols * job.grid.rows;
  const end = Math.min(total, job.next + CELLS_PER_IDLE);
  for (let i = job.next; i < end; i++) bakeCell(job, i);
  job.next = end;
  if (job.next >= total) {
    job.grid.ready = true;
    job.timer = null;
    jobsByMap.delete(job.mapId);
    return;
  }
  job.timer = setTimeout(() => pumpJob(job), 0);
}

export function startMapCollisionBake(
  map: MapItem,
  root: THREE.Object3D,
): void {
  cancelMapCollisionBake(map.id);

  const modular = isModularMap(map);
  // Finer cells track stair treads / thin kit walls better.
  const cell = Math.max(10, Math.min(modular ? 16 : 28, map.gridSize * 0.22));
  const pad = modular ? 0 : cell;
  const originX = pixiToThreeX(map.x) - pad;
  const originZ = pixiToThreeZ(map.y) - pad;
  const width = map.width + pad * 2;
  const height = map.height + pad * 2;
  const cols = Math.max(4, Math.ceil(width / cell));
  const rows = Math.max(4, Math.ceil(height / cell));
  const n = cols * rows;

  const grid: MapCollisionGrid = {
    mapId: map.id,
    originX,
    originZ,
    cell,
    cols,
    rows,
    walkable: new Uint8Array(n),
    blocked: new Uint8Array(n),
    height: new Float32Array(n).fill(MISS),
    ready: false,
    gridSize: map.gridSize,
  };
  gridsByMap.set(map.id, grid);

  root.updateMatrixWorld(true);
  const job: BakeJob = {
    mapId: map.id,
    map,
    root,
    grid,
    next: 0,
    torsoLift: map.gridSize * TORSO_CELLS,
    maxStep: map.gridSize * MAX_STEP_CELLS,
    wallSolid: isModularWall(map),
    gateOpen: isModularGate(map) && Boolean(map.modularOpen),
    timer: null,
  };
  jobsByMap.set(map.id, job);
  job.timer = setTimeout(() => {
    root.updateMatrixWorld(true);
    pumpJob(job);
  }, 180);
}

export function cancelMapCollisionBake(mapId: string): void {
  const job = jobsByMap.get(mapId);
  if (job?.timer != null) clearTimeout(job.timer);
  jobsByMap.delete(mapId);
}

export function clearMapCollisionGrid(mapId: string): void {
  cancelMapCollisionBake(mapId);
  gridsByMap.delete(mapId);
}

export function getMapCollisionGrid(mapId: string): MapCollisionGrid | null {
  return gridsByMap.get(mapId) ?? null;
}

export function punchWalkableDisc(
  mapId: string,
  worldX: number,
  worldZ: number,
  radius: number,
): void {
  const grid = gridsByMap.get(mapId);
  if (!grid?.ready) return;
  const rCells = Math.ceil(radius / grid.cell) + 1;
  const c0 = Math.floor((worldX - grid.originX) / grid.cell);
  const r0 = Math.floor((worldZ - grid.originZ) / grid.cell);
  for (let dr = -rCells; dr <= rCells; dr++) {
    for (let dc = -rCells; dc <= rCells; dc++) {
      const c = c0 + dc;
      const r = r0 + dr;
      if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) continue;
      const wx = grid.originX + (c + 0.5) * grid.cell;
      const wz = grid.originZ + (r + 0.5) * grid.cell;
      if (Math.hypot(wx - worldX, wz - worldZ) > radius) continue;
      const i = r * grid.cols + c;
      grid.blocked[i] = 0;
      if (grid.walkable[i] === 0) {
        grid.walkable[i] = 1;
        const n = i > 0 ? (grid.height[i - 1] ?? MISS) : MISS;
        if ((grid.height[i] ?? MISS) === MISS && n !== MISS) grid.height[i] = n;
      }
    }
  }
}

export function bakedWalkableAt(mapId: string, pixiX: number, pixiY: number): boolean {
  const grid = gridsByMap.get(mapId);
  if (!grid?.ready) return false;
  const i = indexAt(grid, pixiToThreeX(pixiX), pixiToThreeZ(pixiY));
  return i != null && grid.walkable[i] === 1;
}

export function bakedGroundHeight(mapId: string, x: number, z: number, fallback = 0): number {
  const grid = gridsByMap.get(mapId);
  if (!grid?.ready) return fallback;
  const i = indexAt(grid, x, z);
  if (i == null) return fallback;
  const y = grid.height[i] ?? MISS;
  return y === MISS ? fallback : y;
}

/** Bilinear-ish sample for smooth FP eye height on stairs. */
export function bakedGroundHeightSmooth(
  mapId: string,
  x: number,
  z: number,
  fallback = 0,
): number {
  const grid = gridsByMap.get(mapId);
  if (!grid?.ready) return fallback;
  const fx = (x - grid.originX) / grid.cell - 0.5;
  const fz = (z - grid.originZ) / grid.cell - 0.5;
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fz);
  const tx = fx - c0;
  const tz = fz - r0;

  const sample = (c: number, r: number): number | null => {
    if (c < 0 || r < 0 || c >= grid.cols || r >= grid.rows) return null;
    const y = grid.height[r * grid.cols + c] ?? MISS;
    return y === MISS ? null : y;
  };

  const h00 = sample(c0, r0);
  const h10 = sample(c0 + 1, r0);
  const h01 = sample(c0, r0 + 1);
  const h11 = sample(c0 + 1, r0 + 1);
  const vals = [h00, h10, h01, h11].filter((v): v is number => v != null);
  if (vals.length === 0) return fallback;
  if (vals.length < 4) {
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  const a = (h00 as number) * (1 - tx) + (h10 as number) * tx;
  const b = (h01 as number) * (1 - tx) + (h11 as number) * tx;
  return a * (1 - tz) + b * tz;
}

/**
 * True when the move hits a real wall or an unclimbable cliff.
 * Stairs within MAX_STEP_CELLS are allowed.
 */
/** Occupancy of a Kenney/KayKit wall/gate — works before bake and when mesh rays miss. */
export function kitWallBlocksFeet(
  map: MapItem,
  fromX: number,
  fromY: number,
  destX: number,
  destY: number,
  tokenW: number,
  tokenH: number,
): boolean {
  if (!isModularWall(map)) return false;
  const open = isModularGate(map) && Boolean(map.modularOpen);
  const fx = fromX + tokenW / 2;
  const fy = fromY + tokenH / 2;
  const tx = destX + tokenW / 2;
  const ty = destY + tokenH / 2;
  const dist = Math.hypot(tx - fx, ty - fy);
  const step = Math.max(8, Math.min(map.width, map.height) * 0.18);
  const n = Math.max(1, Math.ceil(dist / step));
  const r = Math.min(tokenW, tokenH) * 0.32;
  const offs: Array<[number, number]> = [
    [0, 0],
    [r, 0],
    [-r, 0],
    [0, r],
    [0, -r],
  ];
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const cx = fx + (tx - fx) * t;
    const cy = fy + (ty - fy) * t;
    for (const [ox, oy] of offs) {
      const wx = pixiToThreeX(cx + ox);
      const wz = pixiToThreeZ(cy + oy);
      if (!onWallCenterline(map, wx, wz)) continue;
      if (open && inGateOpening(map, wx, wz)) continue;
      return true;
    }
  }
  return false;
}

export function bakedMeshBlocksFeet(
  map: MapItem,
  fromX: number,
  fromY: number,
  destX: number,
  destY: number,
  tokenW: number,
  tokenH: number,
): boolean {
  if (kitWallBlocksFeet(map, fromX, fromY, destX, destY, tokenW, tokenH)) return true;
  const grid = gridsByMap.get(map.id);
  if (!grid?.ready) return false;

  const fx = pixiToThreeX(fromX + tokenW / 2);
  const fz = pixiToThreeZ(fromY + tokenH / 2);
  const tx = pixiToThreeX(destX + tokenW / 2);
  const tz = pixiToThreeZ(destY + tokenH / 2);

  const maxStep = map.gridSize * MAX_STEP_CELLS;
  const maxCliff = map.gridSize * MAX_CLIFF_CELLS;

  const dist = Math.hypot(tx - fx, tz - fz);
  const steps = Math.max(1, Math.ceil(dist / (grid.cell * 0.4)));
  let prevH = grid.height[indexAt(grid, fx, fz) ?? -1] ?? MISS;
  const kit = isModularMap(map);

  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const x = fx + (tx - fx) * t;
    const z = fz + (tz - fz) * t;
    const i = indexAt(grid, x, z);
    if (i == null) continue;
    const h = grid.height[i] ?? MISS;

    if (grid.blocked[i]) return true;
    if (!grid.walkable[i]) continue;
    if (prevH !== MISS && h !== MISS) {
      const rise = h - prevH;
      if (kit) {
        // Kenney room wall caps sit meters above the floor — not a step.
        if (rise > maxStep) return true;
      } else {
        if (rise > maxStep || rise < -maxCliff) return true;
      }
    }
    if (h !== MISS) prevH = h;
  }
  return false;
}

let lastDoorPunchAt = 0;
let lastDoorSig = '';

export function syncOpenDoorPunches(
  map: MapItem,
  items: Record<string, import('@/systems/scene/types').Item>,
): void {
  const grid = gridsByMap.get(map.id);
  if (!grid?.ready) return;
  const now = performance.now();
  if (now - lastDoorPunchAt < 200) return;

  void import('@/systems/map/props/doorCollision').then(({ doorWallsSignature, isDoorPropOpen }) => {
    const sig = `${map.id}:${doorWallsSignature(map, items)}`;
    if (sig === lastDoorSig && now - lastDoorPunchAt < 2000) return;
    lastDoorSig = sig;
    lastDoorPunchAt = performance.now();

    for (const item of Object.values(items)) {
      if (item.type !== 'image' || !isDoorPropOpen(item)) continue;
      const cx = pixiToThreeX(item.x + item.width / 2);
      const cz = pixiToThreeZ(item.y + item.height / 2);
      const radius = Math.max(item.width, item.height) * 0.55;
      punchWalkableDisc(map.id, cx, cz, radius);
    }
  });
}
