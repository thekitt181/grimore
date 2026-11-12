import { v4 as uuidv4 } from 'uuid';
import type { MapItem, SurfaceDecalItem, TokenItem } from '@/systems/scene/types';
import { itemCenter } from '@/systems/scene/types';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import { useSessionStore } from '@/store/sessionStore';
import { distToSegment, worldToMapLocal } from '@/systems/map/wallUtils';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useFirstPersonStore } from './firstPersonStore';
import { fpSceneRef } from './fpSceneRef';
import { raycastFpSurface, type FpWallHit } from './fpSurfaceRaycast';
import { circleSurfPolygon } from './wallCutMath';
import { pushFpDecalUndo } from './fpPaintUndo';

const SCORCH_COLOR = '#1a120c';

function wallHeightWorld(map: MapItem): number {
  return (map.gridSize || 96) * useMapStore.getState().wallHeightCells;
}

function speakerToken(): TokenItem | null {
  const items = useItemStore.getState().items;
  const fpId = useFirstPersonStore.getState().tokenId;
  if (fpId) {
    const t = items[fpId];
    if (t?.type === 'token') return t;
  }
  const uid = useSessionStore.getState().myUserId;
  const mine = Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && Boolean(uid) && i.ownerId === uid,
  );
  if (mine.length === 1) return mine[0]!;
  const selected = useItemStore.getState().selectedIds
    .map((id) => items[id])
    .find((i): i is TokenItem => i?.type === 'token');
  if (selected) return selected;
  return mine.find((t) => t.ddbCharacterId) ?? mine[0] ?? null;
}

function wallHitAt(map: MapItem, index: number, along: number, height: number): FpWallHit | null {
  const wall = map.walls[index];
  if (!wall) return null;
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const nz = ux;
  const lx = wall.a.x + ux * along;
  const ly = wall.a.y + uy * along;
  return {
    surface: 'wall',
    mapId: map.id,
    wallIndex: index,
    wallA: { ...wall.a },
    wallB: { ...wall.b },
    along,
    height,
    worldX: map.x + lx,
    worldY: height,
    worldZ: map.y + ly,
    nx,
    nz,
    distance: 0,
  };
}

function nearestWallFromLocal(map: MapItem, localX: number, localY: number, height: number): FpWallHit | null {
  const walls = map.walls ?? [];
  let best: { index: number; dist: number; along: number } | null = null;
  for (let i = 0; i < walls.length; i += 1) {
    const wall = walls[i];
    if (!wall) continue;
    const dist = distToSegment(localX, localY, wall);
    const dx = wall.b.x - wall.a.x;
    const dy = wall.b.y - wall.a.y;
    const len = Math.hypot(dx, dy) || 1;
    const along = Math.max(0, Math.min(len, ((localX - wall.a.x) * dx + (localY - wall.a.y) * dy) / len));
    if (!best || dist < best.dist) best = { index: i, dist, along };
  }
  if (!best || best.dist > Math.max(220, (map.gridSize || 96) * 2.2)) return null;
  return wallHitAt(map, best.index, best.along, height);
}

function resolveWallHit(): FpWallHit | null {
  const look = raycastFpSurface(fpSceneRef.current);
  if (look?.surface === 'wall') return look;
  const map = look?.mapId
    ? (() => {
        const it = useItemStore.getState().items[look.mapId];
        return it?.type === 'map' ? it : getActiveMap();
      })()
    : getActiveMap();
  if (!map || !(map.walls?.length)) return null;
  const h = wallHeightWorld(map) * 0.45;
  if (look?.surface === 'floor') {
    const local = worldToMapLocal(look.worldX, look.worldZ, map);
    return nearestWallFromLocal(map, local.x, local.y, h);
  }
  const token = speakerToken();
  if (!token) return nearestWallFromLocal(map, map.width / 2, map.height / 2, h);
  const { cx, cy } = itemCenter(token);
  const local = worldToMapLocal(cx, cy, map);
  return nearestWallFromLocal(map, local.x, local.y, h);
}

function commitWallScorch(hit: FpWallHit, radius: number): void {
  const map = useItemStore.getState().items[hit.mapId];
  if (!map || map.type !== 'map') return;
  const poly = circleSurfPolygon(hit.along, hit.height, radius, 28);
  const surfacePts: number[] = [];
  const dx = hit.wallB.x - hit.wallA.x;
  const dy = hit.wallB.y - hit.wallA.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    surfacePts.push(p.along, p.height);
    const wx = map.x + hit.wallA.x + ux * p.along;
    const wz = map.y + hit.wallA.y + uy * p.along;
    minX = Math.min(minX, wx);
    maxX = Math.max(maxX, wx);
    minZ = Math.min(minZ, wz);
    maxZ = Math.max(maxZ, wz);
  }
  const pad = radius;
  minX -= pad;
  minZ -= pad;
  maxX += pad;
  maxZ += pad;
  const myUserId = useSessionStore.getState().myUserId;
  const item: SurfaceDecalItem = {
    id: uuidv4(),
    type: 'surfaceDecal',
    x: minX,
    y: minZ,
    rotation: 0,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxZ - minZ),
    zIndex: 0,
    locked: false,
    visible: true,
    surface: 'wall',
    mapId: hit.mapId,
    color: SCORCH_COLOR,
    stroke: Math.max(10, radius * 0.55),
    points: surfacePts,
    wallIndex: hit.wallIndex,
    wallA: { ...hit.wallA },
    wallB: { ...hit.wallB },
    mark: 'scorch',
    ...(myUserId ? { ownerId: myUserId } : {}),
  };
  useItemStore.getState().addItem(item);
  emitItemAdd(item);
  pushFpDecalUndo(item.id);
}

/** Stamp a fire/scorch blast on the wall the speaker is looking at (or nearest to their token). */
export function stampVoiceWallScorch(): boolean {
  const hit = resolveWallHit();
  if (!hit) return false;
  const map = useItemStore.getState().items[hit.mapId];
  const grid = map && map.type === 'map' ? map.gridSize : 96;
  commitWallScorch(hit, Math.max(18, grid * 0.42));
  return true;
}
