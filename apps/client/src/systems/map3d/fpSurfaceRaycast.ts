import * as THREE from 'three';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import type { MapItem, WallPoint, WallSegment } from '@/systems/scene/types';
import { worldToMapLocal } from '@/systems/map/wallUtils';
import { distToSegment } from '@/systems/map/wallUtils';
import { displayWalls } from '@/systems/map/props/doorCollision';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef } from './sceneCameraRef';

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2(0, 0);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitTmp = new THREE.Vector3();
const wallHitTmp = new THREE.Vector3();
const wallNormal = new THREE.Vector3();
const wallPlane = new THREE.Plane();

export type FpFloorHit = {
  surface: 'floor';
  mapId: string;
  worldX: number;
  worldY: number;
  worldZ: number;
  localX: number;
  localY: number;
  distance: number;
};

export type FpWallHit = {
  surface: 'wall';
  mapId: string;
  wallIndex: number;
  wallA: WallPoint;
  wallB: WallPoint;
  along: number;
  height: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  nx: number;
  nz: number;
  distance: number;
};

export type FpSurfaceHit = FpFloorHit | FpWallHit;

function closestAuthoredWall(
  map: MapItem,
  localX: number,
  localY: number,
): { index: number; wall: { a: WallPoint; b: WallPoint }; along: number } | null {
  const walls = map.walls ?? [];
  let best: { index: number; wall: { a: WallPoint; b: WallPoint }; along: number; dist: number } | null = null;
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i];
    if (!wall) continue;
    const dist = distToSegment(localX, localY, wall);
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const along = Math.max(0, Math.min(len, ((localX - wall.a.x) * dx + (localY - wall.a.y) * dy) / len));
    if (!best || dist < best.dist) {
      best = { index: i, wall: { a: { ...wall.a }, b: { ...wall.b } }, along, dist };
    }
  }
  if (!best || best.dist > Math.max(48, (map.gridSize || 96) * 0.55)) return null;
  return { index: best.index, wall: best.wall, along: best.along };
}

function wallHeightForMap(map: MapItem): number {
  const cells = useMapStore.getState().wallHeightCells;
  return (map.gridSize || 96) * cells;
}

/**
 * Intersect camera ray with vertical wall quads from authored/display segments.
 * Works even when extruded meshes are missing or blocked by fog/props.
 */
function intersectWallSegments(
  ray: THREE.Ray,
  map: MapItem,
  segments: WallSegment[],
): FpWallHit | null {
  const hMax = wallHeightForMap(map);
  const halfThick = Math.max(4, (map.gridSize || 96) * 0.12) * 0.55;
  let best: FpWallHit | null = null;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (!seg) continue;
    const ax = map.x + seg.a.x;
    const az = map.y + seg.a.y;
    const bx = map.x + seg.b.x;
    const bz = map.y + seg.b.y;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 2) continue;
    const ux = dx / len;
    const uz = dz / len;
    const nx = -uz;
    const nz = ux;

    wallNormal.set(nx, 0, nz);
    // Plane through segment midline.
    wallPlane.setFromNormalAndCoplanarPoint(
      wallNormal,
      hitTmp.set((ax + bx) / 2, hMax * 0.5, (az + bz) / 2),
    );

    if (!ray.intersectPlane(wallPlane, wallHitTmp)) continue;
    if (wallHitTmp.y < -2 || wallHitTmp.y > hMax + 4) continue;

    const along = (wallHitTmp.x - ax) * ux + (wallHitTmp.z - az) * uz;
    if (along < -halfThick || along > len + halfThick) continue;

    // Midline plane hit — push to the face toward the camera (visible surface).
    const towardCam =
      (ray.origin.x - wallHitTmp.x) * nx + (ray.origin.z - wallHitTmp.z) * nz;
    const face = towardCam >= 0 ? 1 : -1;
    wallHitTmp.x += nx * face * halfThick;
    wallHitTmp.z += nz * face * halfThick;

    const dist = ray.origin.distanceTo(wallHitTmp);
    if (dist < 0.05) continue;
    if (best && dist >= best.distance) continue;

    const local = worldToMapLocal(wallHitTmp.x, wallHitTmp.z, map);
    const authored = closestAuthoredWall(map, local.x, local.y);
    const wallA = authored?.wall.a ?? { ...seg.a };
    const wallB = authored?.wall.b ?? { ...seg.b };
    const adx = wallB.x - wallA.x;
    const ady = wallB.y - wallA.y;
    const alen = Math.hypot(adx, ady) || 1;
    const aAlong = authored?.along
      ?? Math.max(0, Math.min(alen, ((local.x - wallA.x) * adx + (local.y - wallA.y) * ady) / alen));
    // Face normal pointing toward camera (outward from wall toward viewer).
    const fnx = nx * face;
    const fnz = nz * face;

    best = {
      surface: 'wall',
      mapId: map.id,
      wallIndex: authored?.index ?? i,
      wallA,
      wallB,
      along: aAlong,
      height: Math.max(0, Math.min(hMax, wallHitTmp.y)),
      worldX: wallHitTmp.x,
      worldY: wallHitTmp.y,
      worldZ: wallHitTmp.z,
      nx: fnx,
      nz: fnz,
      distance: dist,
    };
  }
  return best;
}

function meshWallHit(
  hit: THREE.Intersection,
  map: MapItem,
  obj: THREE.Object3D,
): FpWallHit | null {
  const ax = Number(obj.userData.ax);
  const ay = Number(obj.userData.ay);
  const bx = Number(obj.userData.bx);
  const by = Number(obj.userData.by);
  const local = worldToMapLocal(hit.point.x, hit.point.z, map);
  const authored = closestAuthoredWall(map, local.x, local.y);
  const wallA = authored?.wall.a ?? { x: ax, y: ay };
  const wallB = authored?.wall.b ?? { x: bx, y: by };
  const dx = wallB.x - wallA.x;
  const dy = wallB.y - wallA.y;
  const len = Math.hypot(dx, dy) || 1;
  const along = authored?.along
    ?? Math.max(0, Math.min(len, ((local.x - wallA.x) * dx + (local.y - wallA.y) * dy) / len));
  return {
    surface: 'wall',
    mapId: map.id,
    wallIndex: authored?.index ?? Number(obj.userData.wallIndex ?? 0),
    wallA,
    wallB,
    along,
    height: hit.point.y,
    worldX: hit.point.x,
    worldY: hit.point.y,
    worldZ: hit.point.z,
    nx: -dy / len,
    nz: dx / len,
    distance: hit.distance,
  };
}

/** Raycast from FP camera center onto floor / dungeon walls (mesh + geometric). */
export function raycastFpSurface(scene: THREE.Scene | null): FpSurfaceHit | null {
  const camera = sceneCameraRef.liveCamera;
  if (!camera) return null;

  // Keep ray locked to the rendered camera (crosshair = canvas center).
  camera.updateMatrixWorld(true);
  raycaster.setFromCamera(ndc, camera);
  const ray = raycaster.ray;

  let meshWall: FpWallHit | null = null;
  let geoWall: FpWallHit | null = null;
  let bestFloor: FpFloorHit | null = null;

  // 1) Mesh hits with fpSurface tags (exact visible surface).
  if (scene) {
    const hits = raycaster.intersectObject(scene, true);
    for (const hit of hits) {
      let obj: THREE.Object3D | null = hit.object;
      while (obj) {
        const kind = obj.userData?.fpSurface as string | undefined;
        if (kind === 'wall') {
          const mapId = obj.userData.mapId as string;
          const map = useItemStore.getState().items[mapId];
          if (map && map.type === 'map') {
            const wh = meshWallHit(hit, map, obj);
            // Face normal toward camera for consistent ghost orientation.
            if (wh) {
              const toward =
                (ray.origin.x - wh.worldX) * wh.nx + (ray.origin.z - wh.worldZ) * wh.nz;
              if (toward < 0) {
                wh.nx = -wh.nx;
                wh.nz = -wh.nz;
              }
              if (!meshWall || wh.distance < meshWall.distance) meshWall = wh;
            }
          }
          break;
        }
        if (kind === 'floor') {
          const mapId = obj.userData.mapId as string;
          const map = useItemStore.getState().items[mapId];
          if (map && map.type === 'map') {
            const local = worldToMapLocal(hit.point.x, hit.point.z, map);
            const fh: FpFloorHit = {
              surface: 'floor',
              mapId,
              worldX: hit.point.x,
              worldY: hit.point.y,
              worldZ: hit.point.z,
              localX: local.x,
              localY: local.y,
              distance: hit.distance,
            };
            if (!bestFloor || fh.distance < bestFloor.distance) bestFloor = fh;
          }
          break;
        }
        obj = obj.parent;
      }
    }
  }

  // 2) Geometric wall quads (fallback when meshes missing / blocked).
  const items = useItemStore.getState().items;
  const maps = Object.values(items).filter((i): i is MapItem => i.type === 'map');
  for (const map of maps) {
    if (!(map.walls?.length)) continue;
    const segs = displayWalls(map, items);
    const wh = intersectWallSegments(ray, map, segs);
    if (wh && (!geoWall || wh.distance < geoWall.distance)) geoWall = wh;
  }

  // Prefer mesh surface when both hit the same spot (more accurate than midline math).
  let bestWall: FpWallHit | null = null;
  if (meshWall && geoWall) {
    bestWall = meshWall.distance <= geoWall.distance * 1.25 ? meshWall : geoWall;
  } else {
    bestWall = meshWall ?? geoWall;
  }

  // 3) Ground-plane fallback for floor.
  const map = getActiveMap();
  if (map && ray.intersectPlane(groundPlane, hitTmp)) {
    const local = worldToMapLocal(hitTmp.x, hitTmp.z, map);
    if (local.x >= -8 && local.y >= -8 && local.x <= map.width + 8 && local.y <= map.height + 8) {
      const dist = ray.origin.distanceTo(hitTmp);
      const fh: FpFloorHit = {
        surface: 'floor',
        mapId: map.id,
        worldX: hitTmp.x,
        worldY: 0.05,
        worldZ: hitTmp.z,
        localX: local.x,
        localY: local.y,
        distance: dist,
      };
      if (!bestFloor || fh.distance < bestFloor.distance) bestFloor = fh;
    }
  }

  // Prefer the closer surface. When distances are close, prefer wall so dungeon
  // walls win over the infinite ground plane behind them.
  if (bestWall && bestFloor) {
    if (bestWall.distance <= bestFloor.distance * 1.08) return bestWall;
    return bestFloor;
  }
  return bestWall ?? bestFloor;
}
