import { cellKey } from '@/systems/map/store/mapStore';
import {
  clampTokenFeetToMap,
  fpWallBodyRadius,
  playerVisibleCells,
  tokenMapOrigin,
  wallBlocksMovement,
} from '@/systems/map/fogLos';
import { movementWalls } from '@/systems/map/props/doorCollision';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { tokenBoundsFromGrid, worldToGridColRow } from '@/systems/scene/token/tokenGrid';
import { emitTokenLive, emitTokenMove, emitTokenRotate } from '@/systems/scene/token/tokenSync';
import { clearWalkPose } from '@/systems/scene/token/walkPoseBus';
import { applyWalkPoseVisual } from '@/systems/scene/token/remotePoseApply';
import type { MapItem, TokenItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { followDungeonStair, stairIndexAt } from '@/systems/map/dungeon/placeGeneratedDungeon';
import {
  DEFAULT_WALK_SPEED_FT,
  useFirstPersonStore,
} from './firstPersonStore';
import { adjustFirstPersonLook, firstPersonLook } from './firstPersonLook';
import {
  firstPersonFeetForRender,
  firstPersonPose,
  poseForToken,
  seedFirstPersonPose,
} from './firstPersonPose';
import { bakedMeshBlocksFeet, syncOpenDoorPunches } from './mapCollisionGrid';

export type MoveDir = 'forward' | 'back' | 'left' | 'right';

export function yawForwardWorld(yawDeg: number): { x: number; y: number } {
  const rad = (yawDeg * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad) };
}

export function tokenForwardWorld(token: TokenItem): { x: number; y: number } {
  return yawForwardWorld(token.rotation);
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

export function initiativeMoveLimitFt(tokenId: string): number | null {
  const init = useInitiativeStore.getState();
  if (!init.isActive) return null;
  if (useSessionStore.getState().myRole === 'GM') return null;
  const current = init.combatants[init.currentIndex];
  if (!current?.tokenId || current.tokenId !== tokenId) return 0;
  const turnKey = `${init.round}:${init.currentIndex}`;
  useFirstPersonStore.getState().syncTurn(turnKey);
  return useFirstPersonStore.getState().remainingFeet(tokenId, DEFAULT_WALK_SPEED_FT);
}

let fogCache: { mapId: string; at: number; seen: Set<string> | null } = {
  mapId: '',
  at: 0,
  seen: null,
};

function destinationVisible(token: TokenItem, map: MapItem, destX: number, destY: number): boolean {
  const fogOn = useMapStore.getState().sessionFogActive || useMapStore.getState().fogEnabled;
  const role = useSessionStore.getState().myRole;
  if (!fogOn || role === 'GM') return true;

  const now = performance.now();
  if (fogCache.mapId !== map.id || now - fogCache.at > 200 || !fogCache.seen) {
    const items = useItemStore.getState().items;
    const selectedIds = useItemStore.getState().selectedIds;
    const myUserId = useSessionStore.getState().myUserId;
    fogCache = {
      mapId: map.id,
      at: now,
      seen: playerVisibleCells(
        useMapStore.getState().revealedCells,
        map,
        items,
        myUserId,
        selectedIds,
        map.gridSize,
      ),
    };
  }
  const seen = fogCache.seen;
  if (!seen || seen.size === 0) return true;

  const local = mapLocalFromWorld(destX + token.width / 2, destY + token.height / 2, map);
  const col = Math.floor(local.x / map.gridSize);
  const row = Math.floor(local.y / map.gridSize);
  return seen.has(cellKey(col, row));
}

/** Walls + climb — cheap for binary-search midpoints (no mesh hitch). */
function pathClearCheap(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  destX: number,
  destY: number,
): { ok: boolean; ground: number; rise: number } {
  const probe = { ...token, x: fromX, y: fromY } as TokenItem;
  const from = tokenMapOrigin(probe, map);
  const toLocal = mapLocalFromWorld(destX + token.width / 2, destY + token.height / 2, map);
  const bodyR = fpWallBodyRadius(map);
  const items = useItemStore.getState().items;
  const walls = movementWalls(map, items);
  if (wallBlocksMovement(from, toLocal, walls, bodyR)) {
    return { ok: false, ground: 0, rise: 0 };
  }
  if (map.modelUrl) {
    syncOpenDoorPunches(map, items);
    if (bakedMeshBlocksFeet(map, fromX, fromY, destX, destY, token.width, token.height)) {
      return { ok: false, ground: 0, rise: 0 };
    }
  }
  return { ok: true, ground: 0, rise: 0 };
}

function pathClearFull(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  destX: number,
  destY: number,
): boolean {
  return pathClearCheap(token, map, fromX, fromY, destX, destY).ok;
}

function maybeTakeDungeonStairs(token: TokenItem, map: MapItem, worldX: number, worldY: number): void {
  if (!map.dungeon) return;
  const local = mapLocalFromWorld(worldX + token.width / 2, worldY + token.height / 2, map);
  const index = stairIndexAt(map, local.x, local.y);
  if (index < 0) return;
  followDungeonStair(map, index);
}

/**
 * Local-only feet update — never touches the grid / network mid-stride.
 * Square sync is throttled separately or done on FP exit (AAA realtime walk).
 */
function commitPoseMove(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  nextX: number,
  nextY: number,
  limit: number | null,
): number {
  // Fog: block entering unrevealed space without snapping to cells for the check.
  if (!destinationVisible(token, map, nextX, nextY)) return 0;

  const clamped = clampTokenFeetToMap(map, nextX, nextY, token.width, token.height);
  const dist = Math.hypot(clamped.x - fromX, clamped.y - fromY);
  if (dist < 1e-6) return 0;

  firstPersonPose.x = clamped.x;
  firstPersonPose.y = clamped.y;

  // Initiative budget from real distance walked (not grid squares).
  if (limit !== null && map.gridSize > 0) {
    const feet = (dist / map.gridSize) * 5;
    if (feet > 0.01) useFirstPersonStore.getState().addFeetUsed(token.id, feet);
  }

  return dist;
}

/** Rare stair probe — not every frame. */
export function probeFirstPersonStairs(token: TokenItem): void {
  const map = getActiveMap();
  if (!map || !firstPersonPose.active) return;
  maybeTakeDungeonStairs(token, map, firstPersonPose.x, firstPersonPose.y);
}

/** Local feet — bus only (avoid setLive every frame; that re-renders byId subscribers). */
export function publishFirstPersonLiveLocal(token: TokenItem): void {
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) return;
  const feet = firstPersonFeetForRender();
  applyWalkPoseVisual(token.id, feet.x, feet.y, firstPersonLook.yaw);
}

/** High-rate ephemeral broadcast so other clients see walk as it happens. */
export function broadcastFirstPersonLive(token: TokenItem): void {
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) {
    seedFirstPersonPose(token);
  }
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) return;
  const cx = firstPersonPose.x + token.width / 2;
  const cy = firstPersonPose.y + token.height / 2;
  const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);
  emitTokenLive(
    token.id,
    firstPersonPose.x,
    firstPersonPose.y,
    firstPersonLook.yaw,
    gridCol,
    gridRow,
  );
}

/** Authoritative commit — continuous x/y (gridCol is metadata only, never snaps feet). */
export function syncFirstPersonPosition(token: TokenItem, persist = false): void {
  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) return;
  const cx = firstPersonPose.x + token.width / 2;
  const cy = firstPersonPose.y + token.height / 2;
  const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);
  emitTokenMove(token.id, gridCol, gridRow, firstPersonPose.x, firstPersonPose.y, {
    persist,
  });
  useLiveTransformStore.getState().setLive(
    token.id,
    { x: firstPersonPose.x, y: firstPersonPose.y, rotation: firstPersonLook.yaw },
    { bumpTick: false },
  );
}

/**
 * Continuous walk — cheap binary search, one mesh verify, pull-back if needed.
 * @returns pixels traveled.
 */
export function tryFirstPersonMovePx(
  token: TokenItem,
  dirX: number,
  dirY: number,
  distPx: number,
): number {
  if (distPx < 0.01 || (dirX === 0 && dirY === 0)) return 0;
  const map = getActiveMap();
  if (!map) return 0;

  const limit = initiativeMoveLimitFt(token.id);
  if (limit !== null && limit <= 0) return 0;

  if (!firstPersonPose.active || firstPersonPose.tokenId !== token.id) {
    seedFirstPersonPose(token);
  }

  const fromX = firstPersonPose.x;
  const fromY = firstPersonPose.y;
  const len = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / len;
  const ny = dirY / len;
  let step = distPx;

  if (limit !== null) {
    const maxPx = (limit / 5) * map.gridSize;
    if (step > maxPx) step = maxPx;
  }

  const at = (t: number) => ({ x: fromX + nx * step * t, y: fromY + ny * step * t });

  // Prefer full step; pull back only when blocked (walls only — no GLB mesh rays).
  let p: { x: number; y: number } | null = null;
  const fractions = step < map.gridSize * 0.08
    ? [1, 0.45]
    : [1, 0.72, 0.42, 0.18];
  for (const t of fractions) {
    const cand = at(t);
    if (!pathClearFull(token, map, fromX, fromY, cand.x, cand.y)) continue;
    p = cand;
    break;
  }
  if (!p) return 0;

  return commitPoseMove(token, map, fromX, fromY, p.x, p.y, limit);
}

/** Wish-dir move with wall slide; clips blocked velocity axes. */
export function moveFirstPersonWithSlide(
  token: TokenItem,
  velX: number,
  velY: number,
  dt: number,
): { velX: number; velY: number } {
  const stepX = velX * dt;
  const stepY = velY * dt;
  const wish = Math.hypot(stepX, stepY);
  if (wish < 0.01) return { velX, velY };

  const beforeX = firstPersonPose.x;
  const beforeY = firstPersonPose.y;
  const moved = tryFirstPersonMovePx(token, stepX, stepY, wish);

  if (moved < wish * 0.9) {
    const remScale = Math.max(0, 1 - moved / Math.max(wish, 1e-6));
    if (remScale > 0.05) {
      if (Math.abs(velX) > 1e-3) {
        tryFirstPersonMovePx(token, velX, 0, Math.abs(velX) * dt * remScale);
      }
      if (Math.abs(velY) > 1e-3) {
        tryFirstPersonMovePx(token, 0, velY, Math.abs(velY) * dt * remScale);
      }
    }
  }

  const dx = firstPersonPose.x - beforeX;
  const dy = firstPersonPose.y - beforeY;
  if (Math.hypot(dx, dy) < 0.04) return { velX: 0, velY: 0 };

  let outX = velX;
  let outY = velY;
  if (Math.abs(dx) < Math.abs(stepX) * 0.2) outX = 0;
  if (Math.abs(dy) < Math.abs(stepY) * 0.2) outY = 0;
  const speed = Math.hypot(velX, velY);
  if (outX === 0 && outY !== 0) outY = Math.sign(dy || velY) * speed;
  if (outY === 0 && outX !== 0) outX = Math.sign(dx || velX) * speed;
  return { velX: outX, velY: outY };
}

export function tryFirstPersonStep(token: TokenItem, dir: MoveDir): number | null {
  const map = getActiveMap();
  if (!map) return null;

  const limit = initiativeMoveLimitFt(token.id);
  if (limit !== null && limit < 5) return null;

  const pose = poseForToken(token);
  const { x: fx, y: fy } = yawForwardWorld(firstPersonLook.yaw);
  const rx = -fy;
  const ry = fx;
  let dx = 0;
  let dy = 0;
  if (dir === 'forward') { dx = fx; dy = fy; }
  if (dir === 'back') { dx = -fx; dy = -fy; }
  if (dir === 'left') { dx = -rx; dy = -ry; }
  if (dir === 'right') { dx = rx; dy = ry; }

  const g = map.gridSize;
  const cx = pose.x + token.width / 2 + dx * g;
  const cy = pose.y + token.height / 2 + dy * g;
  const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);
  const bounds = tokenBoundsFromGrid({ ...token, x: pose.x, y: pose.y } as TokenItem, gridCol, gridRow);

  if (!pathClearFull(token, map, pose.x, pose.y, bounds.x, bounds.y)) return null;
  if (!destinationVisible(token, map, bounds.x, bounds.y)) return null;

  const feet = 5;
  if (limit !== null && feet > limit) return null;

  emitTokenMove(token.id, bounds.gridCol, bounds.gridRow, bounds.x, bounds.y);
  firstPersonPose.x = bounds.x;
  firstPersonPose.y = bounds.y;
  firstPersonPose.prevX = bounds.x;
  firstPersonPose.prevY = bounds.y;
  useLiveTransformStore.getState().clear([token.id]);
  if (limit !== null) useFirstPersonStore.getState().addFeetUsed(token.id, feet);
  return feet;
}

export function tryFirstPersonTurn(token: TokenItem, deltaDeg: number, sync = true): void {
  adjustFirstPersonLook(deltaDeg, 0);
  // While walking, rotation rides on walk packets (token:rotate+xy) — no updateItem.
  if (sync) emitTokenRotate(token.id, firstPersonLook.yaw);
}

export function syncFirstPersonYaw(tokenId: string): void {
  emitTokenRotate(tokenId, firstPersonLook.yaw);
}

export function clampDragToMoveBudget(
  tokenId: string,
  dx: number,
  dy: number,
  gridSize: number,
): { dx: number; dy: number } {
  const limit = initiativeMoveLimitFt(tokenId);
  if (limit === null) return { dx, dy };
  if (limit <= 0) return { dx: 0, dy: 0 };
  const distPx = Math.hypot(dx, dy);
  if (distPx < 1e-6) return { dx, dy };
  const maxPx = (limit / 5) * gridSize;
  if (distPx <= maxPx) return { dx, dy };
  const scale = maxPx / distPx;
  return { dx: dx * scale, dy: dy * scale };
}

export function recordDragFeet(tokenId: string, feet: number): void {
  if (initiativeMoveLimitFt(tokenId) === null) return;
  if (feet <= 0) return;
  useFirstPersonStore.getState().addFeetUsed(tokenId, feet);
}

export function commitFirstPersonLive(token: TokenItem): void {
  const pose = poseForToken(token);
  const cx = pose.x + token.width / 2;
  const cy = pose.y + token.height / 2;
  // Keep continuous feet — only record gridCol/row as labels, do not snap to cell origin.
  const { gridCol, gridRow } = worldToGridColRow(cx, cy, token.sizeCells);
  emitTokenMove(token.id, gridCol, gridRow, pose.x, pose.y, { persist: true });
  emitTokenRotate(token.id, firstPersonLook.yaw);
  useLiveTransformStore.getState().clear([token.id]);
  // Drop ephemeral walk override — otherwise Pixi/Three keep snapping feet for ~2s
  // and the token "bounces back" when you try to drag after leaving FP.
  clearWalkPose(token.id);
}
