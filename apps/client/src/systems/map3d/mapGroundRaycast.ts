import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import {
  acceleratedRaycast,
  computeBoundsTree,
  disposeBoundsTree,
} from 'three-mesh-bvh';

// Patch once — GLB map collision / ground samples stay realtime instead of
// walking the full triangle soup every FP frame (dungeon maps skip mesh entirely).
type GeoWithBvh = THREE.BufferGeometry & {
  computeBoundsTree?: typeof computeBoundsTree;
  disposeBoundsTree?: typeof disposeBoundsTree;
  boundsTree?: unknown;
};

let bvhPatched = false;
function ensureBvhPatched(): void {
  if (bvhPatched) return;
  bvhPatched = true;
  THREE.Mesh.prototype.raycast = acceleratedRaycast;
  (THREE.BufferGeometry.prototype as GeoWithBvh).computeBoundsTree = computeBoundsTree;
  (THREE.BufferGeometry.prototype as GeoWithBvh).disposeBoundsTree = disposeBoundsTree;
}

function buildBoundsTrees(root: THREE.Object3D): void {
  ensureBvhPatched();
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const geo = mesh.geometry as GeoWithBvh | undefined;
    if (!geo?.computeBoundsTree) return;
    if (geo.boundsTree) return;
    try {
      // Coarser tree — faster build + queries; FP only needs approx collision.
      geo.computeBoundsTree({ maxLeafTris: 24 });
    } catch {
      /* leave unaccelerated */
    }
  });
}

function disposeBoundsTrees(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const geo = (child as THREE.Mesh).geometry as GeoWithBvh | undefined;
    if (geo?.boundsTree && geo.disposeBoundsTree) {
      try {
        geo.disposeBoundsTree();
      } catch {
        /* ignore */
      }
    }
  });
}

const raycastRoots = new Set<THREE.Object3D>();
let version = 0;
const listeners = new Set<() => void>();
/** While FP walks, skip all map mesh rays (dungeon-parity hot path). */
let raycastPaused = false;

export function setMapRaycastPaused(paused: boolean): void {
  raycastPaused = paused;
}

/** Quantized height cache — coarse so FP doesn't re-raycast every pixel. */
const heightCache = new Map<string, number>();
const MISS = Number.NEGATIVE_INFINITY;
const CACHE_CELL = 40;
const CACHE_MAX = 3000;

function bumpVersion() {
  version += 1;
  heightCache.clear();
  sweepCache.clear();
  for (const l of listeners) l();
}

/** Register a loaded map GLB/STL root for ground-height raycasts (token placement). */
export function registerMapRaycastRoot(
  root: THREE.Object3D,
  collisionMap?: import('@/systems/scene/types').MapItem,
): () => void {
  buildBoundsTrees(root);
  raycastRoots.add(root);
  bumpVersion();
  if (collisionMap) {
    void import('./mapCollisionGrid').then(({ startMapCollisionBake }) => {
      startMapCollisionBake(collisionMap, root);
    });
  }
  return () => {
    raycastRoots.delete(root);
    disposeBoundsTrees(root);
    bumpVersion();
    if (collisionMap) {
      void import('./mapCollisionGrid').then(({ clearMapCollisionGrid }) => {
        clearMapCollisionGrid(collisionMap.id);
      });
    }
  };
}

export function useMapRaycastVersion(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => version,
    () => version,
  );
}

const rayOrigin = new THREE.Vector3();
const rayDir = new THREE.Vector3(0, -1, 0);
const raycaster = new THREE.Raycaster();
raycaster.near = 0;
raycaster.far = 100_000;
raycaster.firstHitOnly = true;

function cacheKey(x: number, z: number): string {
  const qx = Math.round(x / CACHE_CELL);
  const qz = Math.round(z / CACHE_CELL);
  return `${qx},${qz}`;
}

/** Nearest ground hit Y, or null when the ray misses all map meshes. */
function sampleHitY(x: number, z: number): number | null {
  if (raycastRoots.size === 0) return null;

  rayOrigin.set(x, 50_000, z);
  raycaster.set(rayOrigin, rayDir);
  raycaster.firstHitOnly = true;

  let bestY: number | null = null;
  let bestDist = Infinity;

  for (const root of raycastRoots) {
    const hits = raycaster.intersectObject(root, true);
    // firstHitOnly → 0 or 1 hit per mesh, but recurse returns nearest overall
    for (const hit of hits) {
      if (hit.distance < bestDist) {
        bestDist = hit.distance;
        bestY = hit.point.y;
      }
    }
  }

  return bestY;
}

function cachedSample(x: number, z: number): number {
  const key = cacheKey(x, z);
  const cached = heightCache.get(key);
  if (cached !== undefined) return cached;

  const y = sampleHitY(x, z);
  const stored = y ?? MISS;
  if (heightCache.size >= CACHE_MAX) heightCache.clear();
  heightCache.set(key, stored);
  return stored;
}

/** True when a 3D map mesh is under this world XZ (same sample as ground height — one ray). */
export function hasWalkableMapSurface(x: number, z: number): boolean {
  if (raycastPaused || raycastRoots.size === 0) return true;
  return cachedSample(x, z) !== MISS;
}

/** Sample walkable height at world X/Z; falls back when no 3D map mesh / miss. */
export function groundHeightAt(x: number, z: number, fallback = 0): number {
  if (raycastPaused || raycastRoots.size === 0) return fallback;
  const y = cachedSample(x, z);
  return y === MISS ? fallback : y;
}

/** Force a fresh sample (bypasses cache) — use sparingly. */
export function groundHeightAtFresh(x: number, z: number, fallback = 0): number {
  const y = sampleHitY(x, z);
  heightCache.set(cacheKey(x, z), y ?? MISS);
  return y ?? fallback;
}

const moveOrigin = new THREE.Vector3();
const moveDir = new THREE.Vector3();
const moveNormal = new THREE.Vector3();
const moveCaster = new THREE.Raycaster();

/** Short-lived sweep cache — FP can ask identical slides per frame. */
const sweepCache = new Map<string, MeshSweepHit | null>();
const SWEEP_CACHE_MAX = 128;
const SWEEP_CELL = 12;

function sweepKey(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  heightY: number,
): string {
  const q = (v: number) => Math.round(v / SWEEP_CELL);
  return `${q(fromX)},${q(fromZ)}>${q(toX)},${q(toZ)}@${q(heightY)}`;
}

export interface MeshSweepHit {
  travel: number;
  nx: number;
  nz: number;
}

export function meshBlocksMove(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  heightY: number,
  bodyRadius = 14,
  fromGroundY = 0,
  maxStepUp = 40,
): boolean {
  return meshSweepMove(fromX, fromZ, toX, toZ, heightY, bodyRadius, fromGroundY, maxStepUp) != null;
}

/**
 * Character-controller sweep — first blocking wall hit.
 * Floors are skipped via normal; no extra ground ray per hit (that made FP hitch).
 */
export function meshSweepMove(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
  heightY: number,
  bodyRadius = 14,
  _fromGroundY = 0,
  _maxStepUp = 40,
): MeshSweepHit | null {
  if (raycastPaused || raycastRoots.size === 0) return null;

  const key = sweepKey(fromX, fromZ, toX, toZ, heightY);
  if (sweepCache.has(key)) return sweepCache.get(key) ?? null;

  moveDir.set(toX - fromX, 0, toZ - fromZ);
  const dist = moveDir.length();
  if (dist < 0.5) {
    sweepCache.set(key, null);
    return null;
  }
  moveDir.multiplyScalar(1 / dist);

  const start = Math.max(bodyRadius * 0.35, dist * 0.08);
  moveOrigin.set(
    fromX + moveDir.x * start,
    heightY,
    fromZ + moveDir.z * start,
  );
  moveCaster.near = 0;
  moveCaster.far = Math.max(1, dist - start + bodyRadius * 0.55);
  // Torso-height ray — first hit is almost always a wall, not the floor (huge FP win).
  moveCaster.firstHitOnly = true;
  moveCaster.set(moveOrigin, moveDir);

  let best: MeshSweepHit | null = null;

  for (const root of raycastRoots) {
    const hits = moveCaster.intersectObject(root, true);
    const hit = hits[0];
    if (!hit || hit.distance > moveCaster.far) continue;

    let nx = -moveDir.x;
    let nz = -moveDir.z;
    if (hit.face) {
      moveNormal.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
      // Floor / shallow ramp at torso = ignore (open walk).
      if (moveNormal.y > 0.45) continue;
      const flat = Math.hypot(moveNormal.x, moveNormal.z);
      if (flat > 1e-4) {
        nx = moveNormal.x / flat;
        nz = moveNormal.z / flat;
      }
    }

    const travel = start + hit.distance - bodyRadius * 0.45;
    best = { travel: Math.max(0, travel), nx, nz };
    break;
  }

  if (sweepCache.size >= SWEEP_CACHE_MAX) sweepCache.clear();
  sweepCache.set(key, best);
  return best;
}
