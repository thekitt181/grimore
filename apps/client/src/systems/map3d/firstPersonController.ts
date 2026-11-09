/**
 * Game-style FP character controller — continuous move-and-slide.
 * One collision sweep per axis attempt (no binary-search pull-back ladder).
 */
import {
  clampTokenFeetToMap,
  fpWallBodyRadius,
  tokenMapOrigin,
  wallBlocksMovement,
} from '@/systems/map/fogLos';
import { doorWallsSignature, movementWalls } from '@/systems/map/props/doorCollision';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { listModularWallsAlong, listStandFloors } from '@/systems/scene/hitTest';
import { pixiToThreeX, pixiToThreeZ } from './coords';
import { isModularFloorTile, isModularMap } from '@/systems/map/library/modularMapSnap';
import { useSessionStore } from '@/store/sessionStore';
import type { MapItem, TokenItem } from '@/systems/scene/types';
import { firstPersonPose, seedFirstPersonPose } from './firstPersonPose';
import { initiativeMoveLimitFt } from './firstPersonMove';
import { useFirstPersonStore } from './firstPersonStore';
import {
  bakedGroundHeight,
  bakedMeshBlocksFeet,
  bakedWalkableAt,
  syncOpenDoorPunches,
} from './mapCollisionGrid';
import { fpGlobal } from './fpGlobals';
import { steerKitWalk } from './kitWalkSteer';

/** Wall slide passes — keep low; baked mesh is O(1). */
const MAX_SLIDES = 3;
/** First-person only — wander keeps the kit room-shell / rise checks. */
let fpAccurateWalls = false;

/** Reuse wall list for ~1 frame so displace doesn't rebuild every slide. */
let wallsCache: {
  mapId: string;
  doorSig: string;
  at: number;
  walls: ReturnType<typeof movementWalls>;
} = {
  mapId: '',
  doorSig: '',
  at: 0,
  walls: [],
};

function cachedMovementWalls(map: MapItem) {
  const now = performance.now();
  const items = useItemStore.getState().items;
  const doorSig = doorWallsSignature(map, items);
  if (
    wallsCache.mapId === map.id
    && wallsCache.doorSig === doorSig
    && now - wallsCache.at < 32
  ) {
    return wallsCache.walls;
  }
  wallsCache = {
    mapId: map.id,
    doorSig,
    at: now,
    walls: movementWalls(map, items),
  };
  return wallsCache.walls;
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

function wallsNearSegment(
  walls: ReturnType<typeof movementWalls>,
  from: { x: number; y: number },
  to: { x: number; y: number },
  pad: number,
) {
  if (walls.length <= 48) return walls;
  const minX = Math.min(from.x, to.x) - pad;
  const maxX = Math.max(from.x, to.x) + pad;
  const minY = Math.min(from.y, to.y) - pad;
  const maxY = Math.max(from.y, to.y) + pad;
  return walls.filter((w) => {
    const wx0 = Math.min(w.a.x, w.b.x);
    const wx1 = Math.max(w.a.x, w.b.x);
    const wy0 = Math.min(w.a.y, w.b.y);
    const wy1 = Math.max(w.a.y, w.b.y);
    return wx1 >= minX && wx0 <= maxX && wy1 >= minY && wy0 <= maxY;
  });
}

function drawnWallBlocks(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  destX: number,
  destY: number,
): boolean {
  const probe = { ...token, x: fromX, y: fromY } as TokenItem;
  const from = tokenMapOrigin(probe, map);
  const toLocal = mapLocalFromWorld(destX + token.width / 2, destY + token.height / 2, map);
  // Medium-sized capsule — token footprint must not block 1-cell corridors.
  const bodyR = fpWallBodyRadius(map);
  // Red walls + closed door props; cull far segments on dense scanned maps.
  const walls = wallsNearSegment(cachedMovementWalls(map), from, toLocal, bodyR + map.gridSize);
  return wallBlocksMovement(from, toLocal, walls, bodyR);
}

function pickWalkFloor(wx: number, wy: number, pad: number): MapItem | null {
  const floors = listStandFloors(wx, wy, pad);
  if (floors.length === 0) return null;
  const tx = pixiToThreeX(wx);
  const tz = pixiToThreeZ(wy);
  const onMesh = floors.filter((m) => bakedWalkableAt(m.id, wx, wy));
  const pool = onMesh.length ? onMesh : floors;
  pool.sort((a, b) => (
    bakedGroundHeight(b.id, tx, tz, -1e9) - bakedGroundHeight(a.id, tx, tz, -1e9)
  ));
  return pool[0] ?? null;
}

function floorAtToken(token: TokenItem, x: number, y: number): MapItem | null {
  const wx = x + token.width / 2;
  const wy = y + token.height / 2;
  return pickWalkFloor(wx, wy, 0) ?? pickWalkFloor(wx, wy, 36);
}

/** Don't AABB-clamp onto a 2 m tile when the dest is another kit floor. */
function clampFpFeet(
  token: TokenItem,
  map: MapItem,
  destX: number,
  destY: number,
  standX: number,
  standY: number,
): { x: number; y: number } {
  const destFloor = floorAtToken(token, destX, destY);
  if (destFloor) return { x: destX, y: destY };
  const fromFloor = floorAtToken(token, standX, standY) ?? map;
  if (isModularMap(fromFloor) || isModularMap(map)) {
    return clampTokenFeetToMap(fromFloor, destX, destY, token.width, token.height);
  }
  return clampTokenFeetToMap(map, destX, destY, token.width, token.height);
}

function meshBlocksOn(map: MapItem, token: TokenItem, fromX: number, fromY: number, destX: number, destY: number): boolean {
  if (!map.modelUrl) return false;
  if (isModularFloorTile(map)) return false;
  // Scanned image maps false-block for GM; Kenney/KayKit walls must still stop everyone.
  if (useSessionStore.getState().myRole === 'GM' && !isModularMap(map)) return false;
  syncOpenDoorPunches(map, useItemStore.getState().items);
  return bakedMeshBlocksFeet(map, fromX, fromY, destX, destY, token.width, token.height, {
    ignoreKitRise: fpAccurateWalls,
  });
}

/** Authored walls OR baked GLB solids (grid query — no mid-stride mesh rays). */
export function tokenFeetBlocked(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  destX: number,
  destY: number,
): boolean {
  const destFloor = floorAtToken(token, destX, destY);
  const fromFloor = floorAtToken(token, fromX, fromY);
  const kitWalk = isModularMap(map) || (fromFloor != null && isModularMap(fromFloor));

  if (kitWalk) {
    const pad = Math.max(token.width, token.height, 48);
    const wallHits = listModularWallsAlong(
      fromX + token.width / 2,
      fromY + token.height / 2,
      destX + token.width / 2,
      destY + token.height / 2,
      pad,
    );
    for (const wall of wallHits) {
      if (meshBlocksOn(wall, token, fromX, fromY, destX, destY)) return true;
    }
    if (fromFloor && meshBlocksOn(fromFloor, token, fromX, fromY, destX, destY)) return true;
    if (destFloor && destFloor.id !== fromFloor?.id && meshBlocksOn(destFloor, token, fromX, fromY, destX, destY)) {
      return true;
    }
    return false;
  }

  if (drawnWallBlocks(token, map, fromX, fromY, destX, destY)) return true;
  if (fromFloor && fromFloor.id !== map.id && drawnWallBlocks(token, fromFloor, fromX, fromY, destX, destY)) {
    return true;
  }
  if (destFloor && destFloor.id !== map.id && drawnWallBlocks(token, destFloor, fromX, fromY, destX, destY)) {
    return true;
  }
  if (meshBlocksOn(map, token, fromX, fromY, destX, destY)) return true;
  if (fromFloor && fromFloor.id !== map.id && meshBlocksOn(fromFloor, token, fromX, fromY, destX, destY)) {
    return true;
  }
  if (destFloor && destFloor.id !== map.id && meshBlocksOn(destFloor, token, fromX, fromY, destX, destY)) {
    return true;
  }
  return false;
}

/**
 * Try to move `dx,dy` (pixi px). Walls + baked mesh collision + image clamp.
 * Mesh collision is pre-baked — same cost class as dungeon red walls.
 */
function tryDisplace(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): { x: number; y: number; hitNx: number; hitNy: number; blocked: boolean } {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) {
    return { x: fromX, y: fromY, hitNx: 0, hitNy: 0, blocked: false };
  }

  let stepDx = dx;
  let stepDy = dy;
  let forcedSlide = false;
  let slideNx = 0;
  let slideNy = 0;

  let destX = fromX + stepDx;
  let destY = fromY + stepDy;

  // Hard clamp to the map IMAGE rect (skipped when dest is another kit floor).
  const rim = clampFpFeet(token, map, destX, destY, fromX, fromY);
  if (Math.abs(rim.x - destX) > 0.05 || Math.abs(rim.y - destY) > 0.05) {
    destX = rim.x;
    destY = rim.y;
    stepDx = destX - fromX;
    stepDy = destY - fromY;
    forcedSlide = true;
    if (Math.abs(rim.x - (fromX + dx)) > 0.05) slideNx = -Math.sign(dx || 1);
    if (Math.abs(rim.y - (fromY + dy)) > 0.05) slideNy = -Math.sign(dy || 1);
    if (Math.hypot(stepDx, stepDy) < 0.05) {
      return { x: fromX, y: fromY, hitNx: slideNx || -Math.sign(dx || 1), hitNy: slideNy || -Math.sign(dy || 1), blocked: true };
    }
  }

  if (tokenFeetBlocked(token, map, fromX, fromY, destX, destY)) {
    const xOnly = Math.abs(dx) > 0.01 && !tokenFeetBlocked(token, map, fromX, fromY, fromX + dx, fromY);
    const yOnly = Math.abs(dy) > 0.01 && !tokenFeetBlocked(token, map, fromX, fromY, fromX, fromY + dy);
    if (xOnly && !yOnly) {
      stepDx = dx;
      stepDy = 0;
      forcedSlide = true;
      slideNx = 0;
      slideNy = -Math.sign(dy || 1);
    } else if (yOnly && !xOnly) {
      stepDx = 0;
      stepDy = dy;
      forcedSlide = true;
      slideNx = -Math.sign(dx || 1);
      slideNy = 0;
    } else if (xOnly && yOnly) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        stepDx = dx;
        stepDy = 0;
        slideNy = -Math.sign(dy || 1);
      } else {
        stepDx = 0;
        stepDy = dy;
        slideNx = -Math.sign(dx || 1);
      }
      forcedSlide = true;
    } else {
      const inv = 1 / dist;
      return {
        x: fromX,
        y: fromY,
        hitNx: -dx * inv,
        hitNy: -dy * inv,
        blocked: true,
      };
    }
    destX = fromX + stepDx;
    destY = fromY + stepDy;
    const rimAfter = clampFpFeet(token, map, destX, destY, fromX, fromY);
    destX = rimAfter.x;
    destY = rimAfter.y;
  }

  return {
    x: destX,
    y: destY,
    hitNx: slideNx,
    hitNy: slideNy,
    blocked: forcedSlide,
  };
}

function projectOut(vx: number, vy: number, nx: number, ny: number): { x: number; y: number } {
  const nLen = Math.hypot(nx, ny);
  if (nLen < 1e-6) return { x: vx, y: vy };
  const nnx = nx / nLen;
  const nny = ny / nLen;
  const dot = vx * nnx + vy * nny;
  if (dot >= 0) return { x: vx, y: vy }; // leaving wall
  return { x: vx - nnx * dot, y: vy - nny * dot };
}

/**
 * Integrate wish velocity for one frame — Quake-style move-and-slide.
 * @returns clipped velocity for next frame.
 */
export function controlFirstPersonMove(
  token: TokenItem,
  velX: number,
  velY: number,
  dt: number,
): { velX: number; velY: number } {
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) {
    seedFirstPersonPose(token);
  }
  const stand = floorAtToken(token, firstPersonPose.x, firstPersonPose.y);
  const map = stand ?? getActiveMap();
  if (!map) return { velX: 0, velY: 0 };
  if (stand && stand.id !== getActiveMap()?.id) {
    useItemStore.getState().setActiveMap(stand.id);
  }

  const limit = initiativeMoveLimitFt(token.id);
  if (limit !== null && limit <= 0) {
    if (useSessionStore.getState().myRole !== 'GM') {
      fpGlobal.moveBlockedReason = 'initiative';
    }
    return { velX: 0, velY: 0 };
  }
  fpGlobal.moveBlockedReason = null;

  fpAccurateWalls = true;
  try {
  const body = fpWallBodyRadius(map);
  const cx0 = firstPersonPose.x + token.width / 2;
  const cy0 = firstPersonPose.y + token.height / 2;
  const steered0 = steerKitWalk(cx0, cy0, velX * dt, velY * dt, body, { roomShell: false });
  firstPersonPose.x = steered0.x - token.width / 2;
  firstPersonPose.y = steered0.y - token.height / 2;

  let remX = steered0.vx;
  let remY = steered0.vy;
  let outVelX = dt > 1e-6 ? steered0.vx / dt : 0;
  let outVelY = dt > 1e-6 ? steered0.vy / dt : 0;

  if (limit !== null && map.gridSize > 0) {
    const maxPx = (limit / 5) * map.gridSize;
    const remLen = Math.hypot(remX, remY);
    if (remLen > maxPx && remLen > 1e-6) {
      const s = maxPx / remLen;
      remX *= s;
      remY *= s;
    }
  }

  let fromX = firstPersonPose.x;
  let fromY = firstPersonPose.y;
  let walked = 0;

  for (let i = 0; i < MAX_SLIDES; i++) {
    const remLen = Math.hypot(remX, remY);
    if (remLen < 0.15) break;

    const beforeX = fromX;
    const beforeY = fromY;
    const step = tryDisplace(token, map, fromX, fromY, remX, remY);
    fromX = step.x;
    fromY = step.y;
    walked += Math.hypot(fromX - beforeX, fromY - beforeY);

    if (!step.blocked) {
      remX = 0;
      remY = 0;
      break;
    }

    // Slide remainder along the wall.
    const moved = Math.hypot(fromX - beforeX, fromY - beforeY);
    const left = Math.max(0, remLen - moved);
    if (left < 0.15) {
      outVelX = 0;
      outVelY = 0;
      break;
    }
    const slid = projectOut(remX, remY, step.hitNx, step.hitNy);
    const sLen = Math.hypot(slid.x, slid.y);
    if (sLen < 0.15) {
      outVelX = 0;
      outVelY = 0;
      break;
    }
    const scale = left / sLen;
    remX = slid.x * scale;
    remY = slid.y * scale;
    const vSlid = projectOut(outVelX, outVelY, step.hitNx, step.hitNy);
    outVelX = vSlid.x;
    outVelY = vSlid.y;
  }

  const clamped = clampFpFeet(token, map, fromX, fromY, firstPersonPose.x, firstPersonPose.y);
  firstPersonPose.x = clamped.x;
  firstPersonPose.y = clamped.y;
  if (Math.abs(clamped.x - fromX) > 0.05) outVelX = 0;
  if (Math.abs(clamped.y - fromY) > 0.05) outVelY = 0;
  const after = floorAtToken(token, clamped.x, clamped.y);
  if (after && after.id !== map.id) useItemStore.getState().setActiveMap(after.id);

  if (limit !== null && map.gridSize > 0 && walked > 0.01) {
    useFirstPersonStore.getState().addFeetUsed(token.id, (walked / map.gridSize) * 5);
  }

  return { velX: outVelX, velY: outVelY };
  } finally {
    fpAccurateWalls = false;
  }
}

/** Tabletop token drag — same authored-wall collision as first-person walk (DM + players). */
export function clampTokenFeetAgainstWalls(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): { x: number; y: number } {
  const step = tryDisplace(token, map, fromX, fromY, toX - fromX, toY - fromY);
  return { x: step.x, y: step.y };
}

/** Wander / AI — same move-and-slide as FP, without touching the possessed pose. */
export function slideTokenFeet(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  const body = fpWallBodyRadius(map);
  const steered = steerKitWalk(fromX + token.width / 2, fromY + token.height / 2, dx, dy, body);
  let x = steered.x - token.width / 2;
  let y = steered.y - token.height / 2;
  let remX = steered.vx;
  let remY = steered.vy;
  for (let i = 0; i < MAX_SLIDES; i++) {
    const remLen = Math.hypot(remX, remY);
    if (remLen < 0.15) break;
    const beforeX = x;
    const beforeY = y;
    const step = tryDisplace(token, map, x, y, remX, remY);
    x = step.x;
    y = step.y;
    if (!step.blocked) break;
    const moved = Math.hypot(x - beforeX, y - beforeY);
    const left = Math.max(0, remLen - moved);
    if (left < 0.15) break;
    const slid = projectOut(remX, remY, step.hitNx, step.hitNy);
    const sLen = Math.hypot(slid.x, slid.y);
    if (sLen < 0.15) break;
    const scale = left / sLen;
    remX = slid.x * scale;
    remY = slid.y * scale;
  }
  return clampFpFeet(token, map, x, y, fromX, fromY);
}
