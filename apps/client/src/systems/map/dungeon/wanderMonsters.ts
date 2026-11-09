import { v4 as uuidv4 } from 'uuid';
import type { CompendiumMonster } from '@grimoire/shared';
import { queryClient } from '@/lib/queryClient';
import { getMonster } from '@/systems/compendium/compendiumApi';
import { getMonsterAbilities } from '@/systems/compendium/statBlockParser';
import { clampTokenFeetToMap, fpWallBodyRadius, tokenMapOrigin } from '@/systems/map/fogLos';
import { isConcealedDoorProp, isDoorPropClosed, isDoorPropId, isDoorPropOpen } from '@/systems/map/props/doorCollision';
import { resolvePropId, setDungeonDoorOpen } from '@/systems/map/props/dungeonProps';
import { inRoomWallRing, listModularWalls, listModularWallsAlong, mapNearTokenFeet, mapUnderTokenFeet } from '@/systems/scene/hitTest';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { worldToGridColRow } from '@/systems/scene/token/tokenGrid';
import { emitTokenLive, emitTokenMove, emitTokenRotate } from '@/systems/scene/token/tokenSync';
import { applyWalkPoseVisual } from '@/systems/scene/token/remotePoseApply';
import type { ImageItem, Item, MapItem, TokenItem } from '@/systems/scene/types';
import { slideTokenFeet } from '@/systems/map3d/firstPersonController';
import { bakedWalkableAt } from '@/systems/map3d/mapCollisionGrid';
import { wanderNavPath, wanderNavSnap, wanderNavWalkAt } from './wanderNavGrid';
import { wanderGuideNear, wanderGuideSnap, wanderGuideSnapToward } from './wanderGuide';
import {
  generatedFarGoal,
  generatedOpenAt,
  generatedOrbitNext,
  generatedRoomCenters,
  generatedSegHitsSolidWall,
  generatedSegHitsWall,
  generatedWanderGoal,
  generatedWallBlocksStand,
  isGeneratedDungeonMap,
} from './generatedWander';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { mapLocalToWorld, worldToMapLocal } from '@/systems/map/wallUtils';
import { isModularFloorTile, isModularGate, isModularMap, isModularWall, MODULAR_ROOM_WALL_CELLS, pieceForUrl } from '@/systems/map/library/modularKits';

type Heading = { x: number; y: number };

const DIRS: Heading[] = [
  { x: 0, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
];

interface WanderState {
  dir: number;
  yaw: number;
  feetX: number;
  feetY: number;
  nextAt: number;
  lastLive: number;
  lastCommit: number;
  openedDoorId: string | null;
  openedTouched: boolean;
  lastDoorId: string | null;
  goalX: number;
  goalY: number;
  goalDoorId: string | null;
  goalFloorId: string | null;
  goalUntil: number;
  lastMoved: boolean;
  pathIndex: number;
  crossingId: string | null;
  crossingFromId: string | null;
  lastFloorId: string | null;
  stuckMs: number;
  nav: Array<{ x: number; y: number }> | null;
  navKey: string;
  storeX: number;
  storeY: number;
}

const WALK_CELLS_PER_SEC = 1.9;
const YAW_TURN_PER_SEC = 540;
const LIVE_EVERY_MS = 80;
const COMMIT_EVERY_MS = 700;
/** Stay this far from wall faces (5 ft per cell). */
const WALL_KEEP_FT = 0.5;

const stateByToken = new Map<string, WanderState>();
const intFetch = new Set<string>();
const MAX_ENCOUNTER_GROUPS_PER_ROOM = 3;

function randDir(): number {
  return Math.floor(Math.random() * DIRS.length);
}

function dirToward(dx: number, dy: number): number {
  if (dx * dx + dy * dy < 1) return 0;
  const a = Math.atan2(dx, -dy);
  const i = Math.round(a / (Math.PI / 4));
  return ((i % 8) + 8) % 8;
}

function yawFromVec(dx: number, dy: number): number {
  return (Math.atan2(dx, -dy) * 180) / Math.PI;
}

function lerpYaw(from: number, to: number, t: number): number {
  const d = ((to - from + 540) % 360) - 180;
  return from + d * Math.max(0, Math.min(1, t));
}

/** Wandering encounters open and close doors and kit gates. */
export function tokenCanOperateDoors(_token: TokenItem): boolean {
  return true;
}

export function setTokensWandering(tokenIds: string[], wandering: boolean): void {
  const items = useItemStore.getState().items;
  const updates: Array<{ id: string; patch: Partial<TokenItem> }> = [];
  for (const id of tokenIds) {
    const it = items[id];
    if (!it || it.type !== 'token' || it.locked) continue;
    const patch: Partial<TokenItem> = {};
    if (Boolean(it.wandering) !== wandering) patch.wandering = wandering;
    if (wandering && !it.wanderChosen) patch.wanderChosen = true;
    if (Object.keys(patch).length === 0) continue;
    updates.push({ id, patch });
    if (!wandering) {
      const st = stateByToken.get(id);
      if (st) {
        if (st.openedDoorId) {
          const door = items[st.openedDoorId];
          if (door && (door.type === 'image' || door.type === 'map')) closeWanderPortal(door);
        }
        commitWanderPose(it, st, performance.now(), true);
      }
      stateByToken.delete(id);
    }
    else if (it.monsterId && it.monsterInt == null) void fillMonsterInt(id, it.monsterId);
  }
  if (updates.length === 0) return;
  useItemStore.getState().updateItems(updates);
  emitItemUpdate(updates);
  if (wandering) stampMissingEncounterGroups(tokenIds);
}

export function setTokensWanderChosen(tokenIds: string[], chosen: boolean): void {
  const items = useItemStore.getState().items;
  const updates: Array<{ id: string; patch: Partial<TokenItem> }> = [];
  const stopIds: string[] = [];
  for (const id of tokenIds) {
    const it = items[id];
    if (!it || it.type !== 'token' || it.locked) continue;
    const patch: Partial<TokenItem> = {};
    if (Boolean(it.wanderChosen) !== chosen) patch.wanderChosen = chosen;
    if (!chosen && it.wandering) {
      patch.wandering = false;
      stopIds.push(id);
    }
    if (Object.keys(patch).length === 0) continue;
    updates.push({ id, patch });
  }
  if (updates.length === 0) return;
  useItemStore.getState().updateItems(updates);
  emitItemUpdate(updates);
  for (const id of stopIds) {
    const it = items[id];
    if (!it || it.type !== 'token') continue;
    const st = stateByToken.get(id);
    if (st) commitWanderPose(it, st, performance.now(), true);
    stateByToken.delete(id);
  }
}

export function chosenWanderTokens(): TokenItem[] {
  return Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token' && !i.locked && !i.isPc && Boolean(i.wanderChosen),
  );
}

export function toggleChosenWandering(): void {
  const chosen = chosenWanderTokens();
  if (chosen.length === 0) return;
  const anyMoving = chosen.some((t) => t.wandering);
  setTokensWandering(chosen.map((t) => t.id), !anyMoving);
}

export function resetWanderPathIndex(tokenIds: string[]): void {
  for (const id of tokenIds) {
    const st = stateByToken.get(id);
    if (st) st.pathIndex = 0;
  }
}

function tokenPatrolPath(token: TokenItem): Array<{ x: number; y: number }> | null {
  const path = token.wanderPath;
  if (!path || path.length === 0) return null;
  return path;
}

export function stopAllWandering(): number {
  const items = useItemStore.getState().items;
  const ids = Object.values(items)
    .filter((i): i is TokenItem => i.type === 'token' && Boolean(i.wandering))
    .map((t) => t.id);
  setTokensWandering(ids, false);
  stateByToken.clear();
  return ids.length;
}

async function fillMonsterInt(tokenId: string, monsterId: string): Promise<void> {
  if (intFetch.has(tokenId)) return;
  intFetch.add(tokenId);
  try {
    let monster = queryClient.getQueryData<CompendiumMonster>(['compendium', 'monster', monsterId]);
    monster ??= await getMonster(monsterId);
    const int = getMonsterAbilities(monster.description ?? '', monster.stats).find((a) => a.name === 'INT');
    if (int == null) return;
    const live = useItemStore.getState().items[tokenId];
    if (!live || live.type !== 'token') return;
    const patch = { monsterInt: int.score };
    useItemStore.getState().updateItem(tokenId, patch);
    emitItemUpdate([{ id: tokenId, patch }]);
  } catch {
    /* keep door-dumb */
  } finally {
    intFetch.delete(tokenId);
  }
}

function isWanderDoorImage(it: Item): it is ImageItem {
  if (it.type !== 'image') return false;
  if (!isDoorPropId(resolvePropId(it))) return false;
  if (it.visible === false || isConcealedDoorProp(it)) return false;
  return true;
}

function doorsOnMap(items: Record<string, Item>, map: MapItem): ImageItem[] {
  return Object.values(items).filter((i): i is ImageItem => isWanderDoorImage(i)).filter((d) => {
    const cx = d.x + d.width / 2;
    const cy = d.y + d.height / 2;
    return cx >= map.x - d.width && cy >= map.y - d.height
      && cx <= map.x + map.width + d.width && cy <= map.y + map.height + d.height;
  });
}

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

function distPointToSeg2(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 < 1) return dist2(px, py, ax, ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  return dist2(px, ax + t * abx, py, ay + t * aby);
}

function closedPortalOnWay(
  tx: number,
  ty: number,
  gx: number,
  gy: number,
  items: Record<string, Item>,
  cell: number,
  body: number,
): ImageItem | MapItem | null {
  let best: ImageItem | MapItem | null = null;
  let bestD = Infinity;
  const pad = Math.max(cell * 1.6, body * 0.85, 56);
  for (const wall of listModularWallsAlong(tx, ty, gx, gy, pad)) {
    if (!isModularGate(wall) || wall.modularOpen) continue;
    const c = floorCenter(wall);
    const d = dist2(tx, ty, c.x, c.y);
    if (d >= bestD) continue;
    best = wall;
    bestD = d;
  }
  for (const it of Object.values(items)) {
    if (!isWanderDoorImage(it) || !isDoorPropClosed(it)) continue;
    const c = doorCenter(it);
    const hitR = Math.max(it.width, it.height) / 2 + pad;
    if (distPointToSeg2(c.x, c.y, tx, ty, gx, gy) > hitR * hitR) continue;
    const d = dist2(tx, ty, c.x, c.y);
    if (d >= bestD) continue;
    best = it;
    bestD = d;
  }
  return best;
}

function doorCenter(d: ImageItem): { x: number; y: number } {
  return { x: d.x + d.width / 2, y: d.y + d.height / 2 };
}

function portalCenter(p: ImageItem | MapItem): { x: number; y: number } {
  return p.type === 'image' ? doorCenter(p) : floorCenter(p);
}

function portalStillOnRoute(
  portal: ImageItem | MapItem,
  tx: number,
  ty: number,
  gx: number,
  gy: number,
  cell: number,
  body: number,
): boolean {
  const c = portalCenter(portal);
  const pad = Math.max(cell * 1.4, body * 0.7, 48);
  return distPointToSeg2(c.x, c.y, tx, ty, gx, gy) <= pad * pad;
}

function portalUseReach(cell: number, body: number, portal?: ImageItem | MapItem): number {
  const size = portal ? Math.max(portal.width, portal.height) * 0.7 : 0;
  return Math.max(cell * 2.1, body * 1.2, size, 72);
}

function atPortalThreshold(
  tx: number,
  ty: number,
  portal: ImageItem | MapItem,
  cell: number,
  body: number,
): boolean {
  const c = portalCenter(portal);
  const r = portalUseReach(cell, body, portal);
  return dist2(tx, ty, c.x, c.y) < r * r;
}

/** The other leaf of a double door / paired gate on the same opening. */
function mateWanderPortals(
  portal: ImageItem | MapItem,
  items?: Record<string, Item>,
): Array<ImageItem | MapItem> {
  const bag = items ?? useItemStore.getState().items;
  const map = getActiveMap();
  const cell = Math.max(8, map?.gridSize ?? 96);
  const c = portalCenter(portal);
  const alongX = portal.type === 'image'
    ? doorAlongWallX(portal, map)
    : portal.width >= portal.height;
  const maxD = cell * 1.4;
  const out: Array<ImageItem | MapItem> = [portal];
  for (const it of Object.values(bag)) {
    if (it.id === portal.id) continue;
    if (portal.type === 'image') {
      if (!isWanderDoorImage(it)) continue;
      if (doorAlongWallX(it, map) !== alongX) continue;
      const o = doorCenter(it);
      if (dist2(c.x, c.y, o.x, o.y) > maxD * maxD) continue;
      if (alongX) {
        if (Math.abs(o.y - c.y) > cell * 0.55) continue;
      } else if (Math.abs(o.x - c.x) > cell * 0.55) {
        continue;
      }
      out.push(it);
    } else {
      if (it.type !== 'map' || !isModularGate(it)) continue;
      const o = floorCenter(it);
      if (dist2(c.x, c.y, o.x, o.y) > maxD * maxD) continue;
      const mateAlongX = it.width >= it.height;
      if (mateAlongX !== alongX) continue;
      out.push(it);
    }
  }
  return out;
}

function setWanderPortalOpen(portal: ImageItem | MapItem, open: boolean): void {
  if (portal.type === 'image') {
    if (isConcealedDoorProp(portal) || portal.visible === false) return;
    if (open) setDungeonDoorOpen(portal, true);
    else if (isDoorPropOpen(portal)) setDungeonDoorOpen(portal, false);
  } else if (open) {
    setModularGateOpen(portal, true);
  } else if (portal.modularOpen) {
    setModularGateOpen(portal, false);
  }
}

function openWanderPortal(portal: ImageItem | MapItem): void {
  for (const leaf of mateWanderPortals(portal)) setWanderPortalOpen(leaf, true);
}

function closeWanderPortal(portal: ImageItem | MapItem): void {
  for (const leaf of mateWanderPortals(portal)) setWanderPortalOpen(leaf, false);
}

function wandererAtPortal(
  portal: ImageItem | MapItem,
  items: Record<string, Item>,
  skipId: string,
  range: number,
): boolean {
  const c = portalCenter(portal);
  const r2 = range * range;
  for (const it of Object.values(items)) {
    if (it.type !== 'token' || it.id === skipId || !it.wandering) continue;
    if (dist2(it.x + it.width / 2, it.y + it.height / 2, c.x, c.y) < r2) return true;
  }
  return false;
}

function doorClearToClose(
  portal: ImageItem | MapItem,
  tx: number,
  ty: number,
  cell: number,
  items: Record<string, Item>,
  tokenId: string,
): boolean {
  const away = Math.max(cell * 1.15, 64);
  for (const leaf of mateWanderPortals(portal, items)) {
    const c = portalCenter(leaf);
    if (dist2(tx, ty, c.x, c.y) < away * away) return false;
    if (wandererAtPortal(leaf, items, tokenId, cell * 1.05)) return false;
  }
  return true;
}

function rememberOpenedDoor(
  st: WanderState,
  portal: ImageItem | MapItem,
  tx: number,
  ty: number,
  cell: number,
  items: Record<string, Item>,
  tokenId: string,
): void {
  if (st.openedDoorId && st.openedDoorId !== portal.id) {
    const prev = items[st.openedDoorId];
    if (prev && (prev.type === 'image' || prev.type === 'map') && doorClearToClose(prev, tx, ty, cell, items, tokenId)) {
      closeWanderPortal(prev);
    }
  }
  st.openedDoorId = portal.id;
  const c = portalCenter(portal);
  if (dist2(tx, ty, c.x, c.y) < (cell * 1.4) ** 2) st.openedTouched = true;
}

function closedPortalToPass(
  token: TokenItem,
  map: MapItem,
  tx: number,
  ty: number,
  gx: number,
  gy: number,
  items: Record<string, Item>,
  cell: number,
  body: number,
): ImageItem | MapItem | null {
  let portal = closedPortalOnWay(tx, ty, gx, gy, items, cell, body);
  const gux = gx - tx;
  const guy = gy - ty;
  const glen = Math.hypot(gux, guy) || 1;
  const search = cell * 2.6;
  for (const wall of listModularWalls(tx, ty, search)) {
    if (!isModularGate(wall) || wall.modularOpen) continue;
    const c = floorCenter(wall);
    const dx = c.x - tx;
    const dy = c.y - ty;
    const dlen = Math.hypot(dx, dy) || 1;
    const toward = (dx / dlen) * (gux / glen) + (dy / dlen) * (guy / glen);
    if (toward < -0.05 && dlen > cell) continue;
    const d = dist2(tx, ty, c.x, c.y);
    if (!portal || d < dist2(tx, ty, portalCenter(portal).x, portalCenter(portal).y)) portal = wall;
  }
  for (const it of Object.values(items)) {
    if (!isWanderDoorImage(it) || !isDoorPropClosed(it)) continue;
    const c = doorCenter(it);
    if (dist2(tx, ty, c.x, c.y) > search * search) continue;
    const dx = c.x - tx;
    const dy = c.y - ty;
    const dlen = Math.hypot(dx, dy) || 1;
    const toward = (dx / dlen) * (gux / glen) + (dy / dlen) * (guy / glen);
    if (toward < -0.05 && dlen > cell) continue;
    const d = dist2(tx, ty, c.x, c.y);
    if (!portal || d < dist2(tx, ty, portalCenter(portal).x, portalCenter(portal).y)) portal = it;
  }
  if (!portal) return null;
  if (atPortalThreshold(tx, ty, portal, cell, body)) return portal;
  if (portalStillOnRoute(portal, tx, ty, gx, gy, cell, body)) {
    const c = portalCenter(portal);
    if (dist2(tx, ty, c.x, c.y) <= (cell * 2.8) ** 2) return portal;
  }
  return null;
}

/**
 * True when the door sits on a horizontal red wall (passage is north/south).
 * Use the wall, not the sprite AABB — rotated door art was steering into the jamb.
 */
function doorAlongWallX(door: ImageItem, map?: MapItem | null): boolean {
  const m = map ?? getActiveMap();
  if (m?.walls?.length) {
    const local = worldToMapLocal(door.x + door.width / 2, door.y + door.height / 2, m);
    const maxDist = Math.max(8, m.gridSize) * 0.85;
    let bestD = Infinity;
    let horiz = true;
    for (const w of m.walls) {
      const abx = w.b.x - w.a.x;
      const aby = w.b.y - w.a.y;
      const len2 = abx * abx + aby * aby;
      if (len2 < 16) continue;
      const t = Math.max(0, Math.min(1, ((local.x - w.a.x) * abx + (local.y - w.a.y) * aby) / len2));
      const dx = local.x - (w.a.x + abx * t);
      const dy = local.y - (w.a.y + aby * t);
      const d = dx * dx + dy * dy;
      if (d >= bestD) continue;
      bestD = d;
      horiz = Math.abs(abx) >= Math.abs(aby);
    }
    if (bestD <= maxDist * maxDist) return horiz;
  }
  const fp = worldFootprint(door);
  return fp.w >= fp.h;
}

/** Two points just through the opening — pick the far one so they leave the room. */
function doorFarSide(token: TokenItem, door: ImageItem): { x: number; y: number } {
  const c = doorCenter(door);
  const alongX = doorAlongWallX(door);
  const push = Math.max(door.width, door.height) * 0.4 + 48;
  const a = alongX ? { x: c.x, y: c.y + push } : { x: c.x + push, y: c.y };
  const b = alongX ? { x: c.x, y: c.y - push } : { x: c.x - push, y: c.y };
  const tx = token.x + token.width / 2;
  const ty = token.y + token.height / 2;
  return dist2(tx, ty, a.x, a.y) >= dist2(tx, ty, b.x, b.y) ? a : b;
}

function floorCenter(map: MapItem): { x: number; y: number } {
  return { x: map.x + map.width / 2, y: map.y + map.height / 2 };
}

function portalExitGoal(
  token: TokenItem,
  portal: ImageItem | MapItem,
  current: MapItem,
): { x: number; y: number; floorId: string | null } {
  const c = portalCenter(portal);
  const cell = Math.max(8, current.gridSize);
  const push = Math.max(portal.width, portal.height) * 0.55 + cell * 1.6;
  let ax: number;
  let ay: number;
  let bx: number;
  let by: number;
  if (portal.type === 'image') {
    const far = doorFarSide(token, portal);
    const near = { x: c.x * 2 - far.x, y: c.y * 2 - far.y };
    ax = far.x;
    ay = far.y;
    bx = near.x;
    by = near.y;
  } else {
    const thinX = portal.width <= portal.height;
    ax = c.x + (thinX ? push : 0);
    ay = c.y + (thinX ? 0 : push);
    bx = c.x - (thinX ? push : 0);
    by = c.y - (thinX ? 0 : push);
  }
  const tx = token.x + token.width / 2;
  const ty = token.y + token.height / 2;
  const far = dist2(tx, ty, ax, ay) >= dist2(tx, ty, bx, by) ? { x: ax, y: ay } : { x: bx, y: by };
  const dest = mapUnderTokenFeet(far.x, far.y) ?? mapNearTokenFeet(far.x, far.y, 80);
  if (dest && dest.id !== current.id) {
    const mid = floorCenter(dest);
    return { x: mid.x, y: mid.y, floorId: dest.id };
  }
  if (dest) {
    const mid = floorCenter(dest);
    return { x: mid.x, y: mid.y, floorId: dest.id };
  }
  return { x: far.x, y: far.y, floorId: null };
}

function beginCrossing(st: WanderState, token: TokenItem, map: MapItem, portal: ImageItem | MapItem, now: number): void {
  const items = useItemStore.getState().items;
  const cell = Math.max(8, map.gridSize);
  rememberOpenedDoor(
    st,
    portal,
    token.x + token.width / 2,
    token.y + token.height / 2,
    cell,
    items,
    token.id,
  );
  st.crossingId = portal.id;
  st.crossingFromId = map.id;
  st.goalDoorId = portal.type === 'image' ? portal.id : st.goalDoorId;
  if (isGeneratedDungeonMap(map)) {
    st.goalUntil = Math.max(st.goalUntil, now + 18_000);
    return;
  }
  const far = portalExitGoal(token, portal, map);
  const keepRoom = st.goalFloorId != null && itemsRoomGoal(st.goalFloorId);
  if (!keepRoom) {
    st.goalFloorId = far.floorId;
    st.goalX = far.x;
    st.goalY = far.y;
  }
  st.goalUntil = now + 18_000;
}

function itemsRoomGoal(id: string): boolean {
  const it = useItemStore.getState().items[id];
  return it?.type === 'map' && isModularRoom(it);
}

function portalLinksFloors(
  a: MapItem,
  b: MapItem,
  items: Record<string, Item>,
  cell: number,
): boolean {
  const ac = floorCenter(a);
  const bc = floorCenter(b);
  const pad = cell * 1.1;
  for (const wall of listModularWallsAlong(ac.x, ac.y, bc.x, bc.y, pad)) {
    if (isModularGate(wall)) return true;
  }
  for (const it of Object.values(items)) {
    if (!isWanderDoorImage(it)) continue;
    const c = doorCenter(it);
    const hitR = Math.max(it.width, it.height) / 2 + pad;
    if (distPointToSeg2(c.x, c.y, ac.x, ac.y, bc.x, bc.y) <= hitR * hitR) return true;
  }
  return false;
}

function isModularRoom(map: MapItem): boolean {
  return pieceForUrl(map.modelUrl)?.kind === 'room';
}

function encounterGroupKey(token: TokenItem): string {
  return token.encounterGroupId ?? token.monsterId ?? token.id;
}

function stampMissingEncounterGroups(tokenIds: string[]): void {
  const items = useItemStore.getState().items;
  const updates: Array<{ id: string; patch: Partial<TokenItem> }> = [];
  const stamped = new Set<string>();
  for (const id of tokenIds) {
    if (stamped.has(id)) continue;
    const token = items[id];
    if (!token || token.type !== 'token' || token.encounterGroupId) continue;
    const floor = mapUnderTokenFeet(token.x + token.width / 2, token.y + token.height / 2);
    const gid = uuidv4();
    for (const it of Object.values(items)) {
      if (it.type !== 'token' || it.isPc || it.encounterGroupId) continue;
      if (token.monsterId) {
        if (it.monsterId !== token.monsterId) continue;
      } else if (it.id !== token.id) continue;
      const feet = mapUnderTokenFeet(it.x + it.width / 2, it.y + it.height / 2);
      if ((floor?.id ?? null) !== (feet?.id ?? null)) continue;
      stamped.add(it.id);
      updates.push({ id: it.id, patch: { encounterGroupId: gid } });
    }
  }
  if (updates.length === 0) return;
  useItemStore.getState().updateItems(updates);
  emitItemUpdate(updates);
}

function groupsOnFloor(
  floor: MapItem,
  items: Record<string, Item>,
  exceptTokenId?: string,
): Set<string> {
  const groups = new Set<string>();
  for (const it of Object.values(items)) {
    if (it.type !== 'token' || it.isPc || it.id === exceptTokenId) continue;
    const feet = mapUnderTokenFeet(it.x + it.width / 2, it.y + it.height / 2);
    if (!feet || feet.id !== floor.id) continue;
    groups.add(encounterGroupKey(it));
  }
  return groups;
}

function roomWouldExceedGroups(
  floor: MapItem,
  token: TokenItem,
  items: Record<string, Item>,
): boolean {
  if (!isModularRoom(floor)) return false;
  const groups = groupsOnFloor(floor, items, token.id);
  if (groups.has(encounterGroupKey(token))) return false;
  return groups.size >= MAX_ENCOUNTER_GROUPS_PER_ROOM;
}

function dungeonStandFloors(items: Record<string, Item>): MapItem[] {
  return Object.values(items).filter((i): i is MapItem => {
    if (i.type !== 'map' || i.visible === false) return false;
    if (!isModularMap(i) || isModularWall(i)) return false;
    return true;
  });
}

function dungeonRooms(items: Record<string, Item>): MapItem[] {
  return dungeonStandFloors(items).filter((m) => isModularRoom(m));
}

function aabbSep(a: MapItem, b: MapItem): number {
  const dx = Math.max(0, a.x - (b.x + b.width), b.x - (a.x + a.width));
  const dy = Math.max(0, a.y - (b.y + b.height), b.y - (a.y + a.height));
  return Math.hypot(dx, dy);
}

function roomsLinked(a: MapItem, b: MapItem, items: Record<string, Item>, cell: number): boolean {
  if (portalLinksFloors(a, b, items, cell)) return true;
  return aabbSep(a, b) <= cell * 4.6;
}

function nearestRoom(items: Record<string, Item>, wx: number, wy: number, map: MapItem): MapItem | null {
  if (isModularRoom(map)) return map;
  let best: MapItem | null = null;
  let bestD = Infinity;
  for (const room of dungeonRooms(items)) {
    const c = floorCenter(room);
    const d = dist2(wx, wy, c.x, c.y);
    if (d < bestD) {
      bestD = d;
      best = room;
    }
  }
  return best;
}

function edgeToward(from: MapItem, dest: MapItem): { x: number; y: number } {
  const fc = floorCenter(from);
  const dc = floorCenter(dest);
  const dx = dc.x - fc.x;
  const dy = dc.y - fc.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? from.x + from.width : from.x, y: fc.y };
  }
  return { x: fc.x, y: dy >= 0 ? from.y + from.height : from.y };
}

function worldFootprint(it: Pick<MapItem, 'width' | 'height' | 'rotation'>): { w: number; h: number } {
  const rot = ((Math.round((it.rotation ?? 0) / 90) % 4) + 4) % 4;
  const swap = rot === 1 || rot === 3;
  return { w: swap ? it.height : it.width, h: swap ? it.width : it.height };
}

function openingAxis(
  worldW: number,
  worldH: number,
  lip: { x: number; y: number },
): { x: number; y: number; thinX: boolean; cx: number; cy: number } {
  const thinX = worldW <= worldH;
  return { x: lip.x, y: lip.y, thinX, cx: lip.x, cy: lip.y };
}

function portalToward(
  from: MapItem,
  dest: MapItem,
  tx: number,
  ty: number,
  items: Record<string, Item>,
  cell: number,
): { x: number; y: number; thinX: boolean; cx: number; cy: number } | null {
  const fc = floorCenter(from);
  const dc = floorCenter(dest);
  let best: { x: number; y: number; thinX: boolean; cx: number; cy: number } | null = null;
  let bestD = Infinity;
  const pad = cell * 2.2;
  const consider = (cx: number, cy: number, w: number, h: number, near: boolean) => {
    const alongRoute = distPointToSeg2(cx, cy, fc.x, fc.y, dc.x, dc.y) <= (pad * 1.4) ** 2;
    const gx = cx - tx;
    const gy = cy - ty;
    const glen = Math.hypot(gx, gy) || 1;
    const ddx = dc.x - tx;
    const ddy = dc.y - ty;
    const dlen = Math.hypot(ddx, ddy) || 1;
    const toward = (gx / glen) * (ddx / dlen) + (gy / glen) * (ddy / dlen);
    if (near && toward < 0.12) return;
    if (!near && !alongRoute) return;
    const d = dist2(tx, ty, cx, cy) - toward * cell * cell * 6;
    if (d >= bestD) return;
    bestD = d;
    best = openingAxis(w, h, { x: cx, y: cy });
  };
  for (const wall of listModularWalls(tx, ty, pad)) {
    if (!isModularGate(wall)) continue;
    const c = floorCenter(wall);
    const fp = worldFootprint(wall);
    consider(c.x, c.y, fp.w, fp.h, true);
  }
  for (const wall of listModularWallsAlong(fc.x, fc.y, dc.x, dc.y, pad)) {
    if (!isModularGate(wall)) continue;
    const c = floorCenter(wall);
    const fp = worldFootprint(wall);
    consider(c.x, c.y, fp.w, fp.h, true);
  }
  for (const it of Object.values(items)) {
    if (!isWanderDoorImage(it)) continue;
    const c = doorCenter(it);
    const hitR = Math.max(it.width, it.height) / 2 + pad;
    const fp = worldFootprint(it);
    consider(c.x, c.y, fp.w, fp.h, dist2(tx, ty, c.x, c.y) <= hitR * hitR);
  }
  return best;
}

function modularGatesOnMap(items: Record<string, Item>): MapItem[] {
  return Object.values(items).filter((i): i is MapItem => i.type === 'map' && isModularGate(i));
}

function setModularGateOpen(gate: MapItem, open: boolean): void {
  if (Boolean(gate.modularOpen) === open) return;
  const patch = { modularOpen: open, modularOpenAt: Date.now() };
  useItemStore.getState().updateItem(gate.id, patch);
  emitItemUpdate([{ id: gate.id, patch }]);
}

function keepAwayPx(map: MapItem): number {
  return (WALL_KEEP_FT / 5) * Math.max(8, map.gridSize);
}

function pointToMapAabbDist(px: number, py: number, m: MapItem): number {
  const cx = m.x + m.width / 2;
  const cy = m.y + m.height / 2;
  const rad = (-m.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  const qx = Math.max(Math.abs(lx) - m.width / 2, 0);
  const qy = Math.max(Math.abs(ly) - m.height / 2, 0);
  if (qx === 0 && qy === 0) {
    return -Math.min(m.width / 2 - Math.abs(lx), m.height / 2 - Math.abs(ly));
  }
  return Math.hypot(qx, qy);
}

function isSolidKeepWall(wall: MapItem): boolean {
  return isModularWall(wall) && !wanderWallPassable(wall);
}

function nearestWallGap(cx: number, cy: number, search: number): number {
  let best = search;
  for (const wall of listModularWalls(cx, cy, search)) {
    if (!isSolidKeepWall(wall)) continue;
    const d = pointToMapAabbDist(cx, cy, wall);
    if (d < best) best = d;
  }
  return best;
}

function wallPushAt(cx: number, cy: number, search: number): { x: number; y: number } {
  let ax = 0;
  let ay = 0;
  for (const wall of listModularWalls(cx, cy, search)) {
    if (!isSolidKeepWall(wall)) continue;
    const wcx = wall.x + wall.width / 2;
    const wcy = wall.y + wall.height / 2;
    let dx = cx - wcx;
    let dy = cy - wcy;
    const len = Math.hypot(dx, dy) || 1;
    const gap = pointToMapAabbDist(cx, cy, wall);
    const w = Math.max(0.15, search - gap);
    ax += (dx / len) * w;
    ay += (dy / len) * w;
  }
  return { x: ax, y: ay };
}

const SIDES = ['N', 'E', 'S', 'W'] as const;
type Side = (typeof SIDES)[number];

function worldOpenings(map: MapItem): Side[] {
  const piece = pieceForUrl(map.modelUrl);
  if (!piece?.openings?.length) return [];
  const steps = ((Math.round((map.rotation ?? 0) / 90) % 4) + 4) % 4;
  return piece.openings.map((s) => SIDES[(SIDES.indexOf(s as Side) - steps + 4) % 4]!);
}

function openingOnSide(map: MapItem, side: Side, cell: number): { cx: number; cy: number; thinX: boolean; x: number; y: number } {
  const fc = floorCenter(map);
  const inset = cell * 0.85;
  const through = cell * 1.7;
  switch (side) {
    case 'W':
      return { cx: map.x + inset, cy: fc.y, thinX: true, x: map.x - through, y: fc.y };
    case 'E':
      return { cx: map.x + map.width - inset, cy: fc.y, thinX: true, x: map.x + map.width + through, y: fc.y };
    case 'N':
      return { cx: fc.x, cy: map.y + inset, thinX: false, x: fc.x, y: map.y - through };
    default:
      return { cx: fc.x, cy: map.y + map.height - inset, thinX: false, x: fc.x, y: map.y + map.height + through };
  }
}

function openingLeadsSomewhere(map: MapItem, side: Side, cell: number): boolean {
  const p = openingOnSide(map, side, cell);
  const outside = mapUnderTokenFeet(p.x, p.y) ?? mapNearTokenFeet(p.x, p.y, cell * 0.8);
  return Boolean(outside && outside.id !== map.id);
}

function liveOpenings(map: MapItem, cell: number): Side[] {
  const authored = worldOpenings(map);
  const sides = authored.length ? authored : SIDES;
  const live = sides.filter((side) => openingLeadsSomewhere(map, side, cell));
  return live.length ? live : authored;
}

function roomOpeningToward(from: MapItem, dest: MapItem, cell: number): {
  cx: number;
  cy: number;
  thinX: boolean;
  x: number;
  y: number;
} | null {
  const openings = liveOpenings(from, cell);
  if (openings.length === 0) return null;
  const dc = floorCenter(dest);
  const fc = floorCenter(from);
  let best: Side | null = null;
  let bestDot = -Infinity;
  const ux = dc.x - fc.x;
  const uy = dc.y - fc.y;
  const ulen = Math.hypot(ux, uy) || 1;
  for (const side of openings) {
    const n = side === 'E' ? { x: 1, y: 0 }
      : side === 'W' ? { x: -1, y: 0 }
      : side === 'S' ? { x: 0, y: 1 }
      : { x: 0, y: -1 };
    const dot = (n.x * ux + n.y * uy) / ulen;
    if (dot > bestDot) {
      bestDot = dot;
      best = side;
    }
  }
  if (!best || bestDot < 0.15) return null;
  return openingOnSide(from, best, cell);
}

function nearRoomOpening(cx: number, cy: number, range: number): boolean {
  const range2 = range * range;
  for (const floor of dungeonStandFloors(useItemStore.getState().items)) {
    const kind = pieceForUrl(floor.modelUrl)?.kind;
    if (kind !== 'room' && kind !== 'hall') continue;
    const cell = Math.max(8, floor.gridSize);
    for (const side of worldOpenings(floor)) {
      const p = openingOnSide(floor, side, cell);
      if (dist2(cx, cy, p.cx, p.cy) <= range2 || dist2(cx, cy, p.x, p.y) <= range2) return true;
    }
  }
  return false;
}

function nearPortal(cx: number, cy: number, range: number): boolean {
  for (const wall of listModularWalls(cx, cy, range)) {
    if (isModularGate(wall)) return true;
  }
  const range2 = range * range;
  for (const it of Object.values(useItemStore.getState().items)) {
    if (!isWanderDoorImage(it)) continue;
    const c = doorCenter(it);
    if (dist2(cx, cy, c.x, c.y) <= range2) return true;
  }
  return nearRoomOpening(cx, cy, range);
}

/** Narrow strip through a doorway — not a fat circle that includes jambs. */
function inDoorLane(wx: number, wy: number, cell: number, openOnly = false): boolean {
  const half = cell * 0.52;
  const along = cell * 3.05;
  for (const floor of dungeonStandFloors(useItemStore.getState().items)) {
    const kind = pieceForUrl(floor.modelUrl)?.kind;
    if (kind !== 'room' && kind !== 'hall') continue;
    const gs = Math.max(8, floor.gridSize);
    for (const side of worldOpenings(floor)) {
      const p = openingOnSide(floor, side, gs);
      if (p.thinX) {
        if (Math.abs(wy - p.cy) <= half && Math.abs(wx - p.cx) <= along) return true;
      } else if (Math.abs(wx - p.cx) <= half && Math.abs(wy - p.cy) <= along) {
        return true;
      }
    }
  }
  for (const wall of listModularWalls(wx, wy, cell * 1.4)) {
    if (!isModularGate(wall)) continue;
    if (openOnly && !wall.modularOpen) continue;
    const c = floorCenter(wall);
    const fp = worldFootprint(wall);
    const thinX = fp.w <= fp.h;
    const across = Math.min(fp.w, fp.h) * 0.28 + cell * 0.12;
    const long = Math.max(fp.w, fp.h) * 0.55 + cell * 0.7;
    if (thinX) {
      if (Math.abs(wx - c.x) <= across && Math.abs(wy - c.y) <= long) return true;
    } else if (Math.abs(wy - c.y) <= across && Math.abs(wx - c.x) <= long) {
      return true;
    }
  }
  for (const it of Object.values(useItemStore.getState().items)) {
    if (it.type !== 'image' || !isDoorPropId(resolvePropId(it))) continue;
    if (it.visible === false && !isConcealedDoorProp(it)) continue;
    if (openOnly && !isDoorPropOpen(it) && !isConcealedDoorProp(it)) continue;
    const c = doorCenter(it);
    const fp = worldFootprint(it);
    const thinX = fp.w <= fp.h;
    const across = Math.max(cell * 0.42, Math.min(fp.w, fp.h) * 0.55 + cell * 0.2);
    const long = Math.max(fp.w, fp.h) * 0.7 + cell * 0.85;
    if (thinX) {
      if (Math.abs(wx - c.x) <= across && Math.abs(wy - c.y) <= long) return true;
    } else if (Math.abs(wy - c.y) <= across && Math.abs(wx - c.x) <= long) {
      return true;
    }
  }
  return false;
}

function steerToDoorCenter(
  tx: number,
  ty: number,
  aimX: number,
  aimY: number,
  items: Record<string, Item>,
  cell: number,
  map?: MapItem | null,
): { x: number; y: number } {
  let best: ImageItem | null = null;
  let bestD = Infinity;
  const reach = cell * 2.4;
  for (const it of Object.values(items)) {
    if (it.type !== 'image' || !isDoorPropId(resolvePropId(it))) continue;
    if (it.visible === false && !isConcealedDoorProp(it)) continue;
    const c = doorCenter(it);
    const d = dist2(tx, ty, c.x, c.y);
    if (d > reach * reach || d >= bestD) continue;
    const onWay = distPointToSeg2(c.x, c.y, tx, ty, aimX, aimY) <= (cell * 1.2) ** 2;
    if (!onWay && d > (cell * 1.1) ** 2) continue;
    best = it;
    bestD = d;
  }
  if (!best) return { x: aimX, y: aimY };
  const c = doorCenter(best);
  const alongWallX = doorAlongWallX(best, map);
  const through = cell * 1.35;
  if (alongWallX) {
    const dir = Math.abs(aimY - ty) > 1 ? Math.sign(aimY - ty) : (ty > c.y ? -1 : 1);
    return { x: c.x, y: c.y + dir * through };
  }
  const dir = Math.abs(aimX - tx) > 1 ? Math.sign(aimX - tx) : (tx > c.x ? -1 : 1);
  return { x: c.x + dir * through, y: c.y };
}

function pointInDoorOpening(
  wx: number,
  wy: number,
  door: ImageItem,
  cell: number,
  map?: MapItem | null,
): boolean {
  const c = doorCenter(door);
  const alongX = doorAlongWallX(door, map);
  const across = cell * 0.62;
  const along = cell * 1.35;
  if (alongX) return Math.abs(wx - c.x) <= across && Math.abs(wy - c.y) <= along;
  return Math.abs(wy - c.y) <= across && Math.abs(wx - c.x) <= along;
}

function doorInLaneAt(wx: number, wy: number, cell: number): ImageItem | null {
  let best: ImageItem | null = null;
  let bestD = Infinity;
  for (const it of Object.values(useItemStore.getState().items)) {
    if (it.type !== 'image' || !isDoorPropId(resolvePropId(it))) continue;
    if (it.visible === false && !isConcealedDoorProp(it)) continue;
    if (!pointInDoorOpening(wx, wy, it, cell)) continue;
    const c = doorCenter(it);
    const d = dist2(wx, wy, c.x, c.y);
    if (d >= bestD) continue;
    best = it;
    bestD = d;
  }
  return best;
}

function headingFacesPortal(tx: number, ty: number, ux: number, uy: number, range: number): boolean {
  for (const wall of listModularWalls(tx, ty, range)) {
    if (!isModularGate(wall)) continue;
    const c = floorCenter(wall);
    const dx = c.x - tx;
    const dy = c.y - ty;
    const len = Math.hypot(dx, dy) || 1;
    if ((dx / len) * ux + (dy / len) * uy > 0.22) return true;
  }
  const range2 = range * range;
  for (const it of Object.values(useItemStore.getState().items)) {
    if (!isWanderDoorImage(it)) continue;
    const c = doorCenter(it);
    if (dist2(tx, ty, c.x, c.y) > range2) continue;
    const dx = c.x - tx;
    const dy = c.y - ty;
    const len = Math.hypot(dx, dy) || 1;
    if ((dx / len) * ux + (dy / len) * uy > 0.22) return true;
  }
  return false;
}

function wanderWallPassable(wall: MapItem): boolean {
  if (isModularGate(wall)) return true;
  const key = pieceForUrl(wall.modelUrl)?.key ?? '';
  return /doorway|gated|crossing|tsplit|corner|window_open|open_scaffold/i.test(key);
}

function wallLocalPx(wall: MapItem, wx: number, wy: number): { lx: number; ly: number } {
  const cx = wall.x + wall.width / 2;
  const cy = wall.y + wall.height / 2;
  const rad = (-wall.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    lx: dx * Math.cos(rad) - dy * Math.sin(rad),
    ly: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Thin long-axis slab only. Fat KayKit AABBs (corners, crosses, door sides) are walkable. */
function thinKitWallHits(
  wall: MapItem,
  fromX: number,
  fromY: number,
  nx: number,
  ny: number,
  tokenW: number,
  tokenH: number,
): boolean {
  if (wanderWallPassable(wall)) return false;
  const short = Math.min(wall.width, wall.height);
  const long = Math.max(wall.width, wall.height);
  if (long / Math.max(1, short) < 1.35) return false;
  const cell = Math.max(8, wall.gridSize);
  const half = Math.min(short * 0.22, cell * 0.22);
  const fx = fromX + tokenW / 2;
  const fy = fromY + tokenH / 2;
  const tx = nx + tokenW / 2;
  const ty = ny + tokenH / 2;
  const dist = Math.hypot(tx - fx, ty - fy);
  const n = Math.max(1, Math.ceil(dist / Math.max(8, cell * 0.2)));
  for (let s = 1; s <= n; s++) {
    const t = s / n;
    const { lx, ly } = wallLocalPx(wall, fx + (tx - fx) * t, fy + (ty - fy) * t);
    const across = wall.width <= wall.height ? lx : ly;
    const along = wall.width <= wall.height ? ly : lx;
    if (Math.abs(along) > long / 2) continue;
    if (Math.abs(across) <= half) return true;
  }
  return false;
}

function solidKitWallsBlock(
  token: TokenItem,
  fromX: number,
  fromY: number,
  nx: number,
  ny: number,
): boolean {
  const pad = Math.max(token.width, token.height, 24);
  const walls = listModularWallsAlong(
    fromX + token.width / 2,
    fromY + token.height / 2,
    nx + token.width / 2,
    ny + token.height / 2,
    pad,
  );
  for (const wall of walls) {
    if (thinKitWallHits(wall, fromX, fromY, nx, ny, token.width, token.height)) return true;
  }
  return false;
}

function kenneyShellBlocks(map: MapItem, wx: number, wy: number, cell: number): boolean {
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (kind !== 'room' && kind !== 'hall') return false;
  if (nearPortal(wx, wy, cell * 1.6)) return false;
  const other = mapUnderTokenFeet(wx, wy) ?? mapNearTokenFeet(wx, wy, cell);
  if (other && other.id !== map.id) return false;
  const inset = cell * (kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) > map.width / 2 - inset || Math.abs(ly) > map.height / 2 - inset;
}

function wanderBlocked(
  token: TokenItem,
  map: MapItem,
  fromX: number,
  fromY: number,
  nx: number,
  ny: number,
  _keep: number,
  ignoreKeep: boolean,
): boolean {
  const destCx = nx + token.width / 2;
  const destCy = ny + token.height / 2;
  const cell = Math.max(8, map.gridSize);
  const inOpening = ignoreKeep || nearPortal(destCx, destCy, cell * 1.6)
    || nearPortal(fromX + token.width / 2, fromY + token.height / 2, cell * 1.6);
  if (inOpening) return false;
  const destFloor = mapUnderTokenFeet(destCx, destCy) ?? mapNearTokenFeet(destCx, destCy, cell);
  if (destFloor && isModularFloorTile(destFloor)) {
    return solidKitWallsBlock(token, fromX, fromY, nx, ny);
  }
  if (solidKitWallsBlock(token, fromX, fromY, nx, ny)) return true;
  if (destFloor && kenneyShellBlocks(destFloor, destCx, destCy, cell)) return true;
  if (destFloor?.id === map.id && kenneyShellBlocks(map, destCx, destCy, cell)) return true;
  return false;
}

function poseClear(
  token: TokenItem,
  map: MapItem,
  nx: number,
  ny: number,
  keep: number,
  ignoreKeep: boolean,
): boolean {
  return !wanderBlocked(token, map, token.x, token.y, nx, ny, keep, ignoreKeep);
}

function headingHitsWall(
  token: TokenItem,
  map: MapItem,
  from: { x: number; y: number },
  dir: number,
  dist: number,
  keep: number,
  ignoreKeep: boolean,
): boolean {
  const h = DIRS[dir]!;
  const u = dirUnit(dir);
  const cell = Math.max(8, map.gridSize);
  const tx = token.x + token.width / 2;
  const ty = token.y + token.height / 2;
  if (headingFacesPortal(tx, ty, u.x, u.y, cell * 2.8)) return false;
  const worldC = mapLocalToWorld(from.x + h.x * dist, from.y + h.y * dist, map);
  const nx = worldC.x - token.width / 2;
  const ny = worldC.y - token.height / 2;
  return wanderBlocked(token, map, token.x, token.y, nx, ny, keep, ignoreKeep);
}

function dirUnit(dir: number): { x: number; y: number } {
  const h = DIRS[dir]!;
  const n = Math.hypot(h.x, h.y) || 1;
  return { x: h.x / n, y: h.y / n };
}

/** Drop any walk that heads into a nearby wall; keep door approaches. */
function steerOffWalls(
  token: TokenItem,
  map: MapItem,
  from: { x: number; y: number },
  cell: number,
  keep: number,
  goalX: number,
  goalY: number,
  allowPortalApproach: boolean,
): { vx: number; vy: number; open: boolean[]; aimDir: number } {
  const tx = token.x + token.width / 2;
  const ty = token.y + token.height / 2;
  const gdx = goalX - tx;
  const gdy = goalY - ty;
  const glen = Math.hypot(gdx, gdy) || 1;
  const gux = gdx / glen;
  const guy = gdy / glen;
  let vx = gux;
  let vy = guy;

  const floor = mapUnderTokenFeet(tx, ty) ?? map;
  const lane = floorCenter(floor);
  const lx = goalX - lane.x;
  const ly = goalY - lane.y;
  const llen = Math.hypot(lx, ly) || 1;
  const ux = lx / llen;
  const uy = ly / llen;
  const rx = tx - lane.x;
  const ry = ty - lane.y;
  const latX = rx - (rx * ux + ry * uy) * ux;
  const latY = ry - (rx * ux + ry * uy) * uy;
  const lat = Math.hypot(latX, latY);
  if (!allowPortalApproach && lat > cell * 0.1) {
    const latW = Math.min(1.0, lat / cell);
    vx -= (latX / lat) * latW;
    vy -= (latY / lat) * latW;
  }

  const near = keep;
  const mid = keep + cell * 0.12;
  const blockedNear = DIRS.map((_, dir) => headingHitsWall(token, map, from, dir, near, keep, false));
  const blockedMid = DIRS.map((_, dir) => headingHitsWall(token, map, from, dir, mid, keep, false));
  const open = blockedNear.map((b, i) => !b && !blockedMid[i]);
  const push = wallPushAt(tx, ty, Math.min(token.width, token.height) / 2 + keep + 24);
  vx += push.x / Math.max(1, cell);
  vy += push.y / Math.max(1, cell);

  for (let i = 0; i < DIRS.length; i++) {
    if (!blockedNear[i] && !blockedMid[i]) continue;
    const u = dirUnit(i);
    if (allowPortalApproach && u.x * gux + u.y * guy > 0.42) continue;
    const toward = vx * u.x + vy * u.y;
    if (toward <= 0.02) continue;
    const cut = blockedNear[i] ? 1 : 0.85;
    vx -= u.x * toward * cut;
    vy -= u.y * toward * cut;
  }

  let slen = Math.hypot(vx, vy);
  if (slen < 0.18) {
    let best = -1;
    let bestDot = -Infinity;
    for (let i = 0; i < DIRS.length; i++) {
      if (blockedNear[i]) continue;
      const u = dirUnit(i);
      const d = u.x * gux + u.y * guy;
      if (d > bestDot) {
        bestDot = d;
        best = i;
      }
    }
    if (best >= 0) {
      vx = DIRS[best]!.x;
      vy = DIRS[best]!.y;
    } else {
      vx = 0;
      vy = 0;
      for (let i = 0; i < DIRS.length; i++) {
        if (!blockedNear[i]) continue;
        vx -= DIRS[i]!.x;
        vy -= DIRS[i]!.y;
      }
    }
    slen = Math.hypot(vx, vy);
  }
  if (slen > 0.01) {
    vx /= slen;
    vy /= slen;
  } else {
    vx = 0;
    vy = 0;
  }
  return { vx, vy, open, aimDir: dirToward(vx, vy) };
}

function stepHeadsIntoWall(
  dx: number,
  dy: number,
  open: boolean[],
  allowPortalApproach: boolean,
  gux: number,
  guy: number,
): boolean {
  const len = Math.hypot(dx, dy);
  if (len < 0.08) return true;
  const ux = dx / len;
  const uy = dy / len;
  for (let i = 0; i < DIRS.length; i++) {
    if (open[i]) continue;
    const u = dirUnit(i);
    if (allowPortalApproach && u.x * gux + u.y * guy > 0.42) continue;
    if (ux * u.x + uy * u.y > 0.28) return true;
  }
  return false;
}

function destFeetClear(
  token: TokenItem,
  map: MapItem,
  nx: number,
  ny: number,
  keep: number,
  ignoreKeep: boolean,
): boolean {
  return !wanderBlocked(token, map, nx, ny, nx, ny, keep, ignoreKeep);
}

function tryWorldFeet(
  token: TokenItem,
  map: MapItem,
  nx: number,
  ny: number,
  items: Record<string, Item>,
  radius: number,
  keep: number,
  ignoreKeep: boolean,
): { x: number; y: number; opened?: ImageItem | MapItem } | null {
  const destCx = nx + token.width / 2;
  const destCy = ny + token.height / 2;
  const destFloor = mapUnderTokenFeet(destCx, destCy)
    ?? (isModularMap(map) ? mapNearTokenFeet(destCx, destCy, 72) : null);
  if (!destFloor) {
    const throughOpening = ignoreKeep || nearPortal(destCx, destCy, 56);
    if (isModularMap(map) && !throughOpening) return null;
    if (!throughOpening) {
      const clamped = clampTokenFeetToMap(map, nx, ny, token.width, token.height, radius);
      nx = clamped.x;
      ny = clamped.y;
    }
  } else if (
    destFloor.id !== map.id
    && !tokenPatrolPath(token)
    && roomWouldExceedGroups(destFloor, token, items)
  ) {
    return null;
  }
  if (poseClear(token, map, nx, ny, keep, ignoreKeep)) return { x: nx, y: ny };
  const cell = Math.max(8, map.gridSize);
  const body = Math.min(token.width, token.height);
  const fromCx = token.x + token.width / 2;
  const fromCy = token.y + token.height / 2;
  const portal = closedPortalOnWay(fromCx, fromCy, destCx, destCy, items, cell, body);
  if (portal) {
    openWanderPortal(portal);
    return { x: nx, y: ny, opened: portal };
  }
  if (ignoreKeep || nearPortal(destCx, destCy, cell * 1.4) || nearPortal(fromCx, fromCy, cell * 1.4)) {
    return { x: nx, y: ny };
  }
  const overlapping = wanderBlocked(token, map, token.x, token.y, token.x, token.y, keep, ignoreKeep);
  if (overlapping && destFeetClear(token, map, nx, ny, keep, ignoreKeep)) return { x: nx, y: ny };
  return null;
}

function tryUnstuckFeet(
  token: TokenItem,
  map: MapItem,
  items: Record<string, Item>,
  radius: number,
  cell: number,
  keep: number,
  ignoreKeep: boolean,
  goalX: number,
  goalY: number,
): { x: number; y: number } | null {
  const cx = token.x + token.width / 2;
  const cy = token.y + token.height / 2;
  const bodyR = Math.min(token.width, token.height) / 2;
  const overlapping = wanderBlocked(token, map, token.x, token.y, token.x, token.y, keep, ignoreKeep);
  if (!overlapping) return null;
  const mid = floorCenter(map);
  const push = wallPushAt(cx, cy, bodyR + keep + 16);
  const byDoor = nearPortal(cx, cy, cell * 1.6);
  const dirs: Array<{ x: number; y: number }> = [
    { x: goalX - cx, y: goalY - cy },
    push,
    ...(byDoor ? [] : [{ x: mid.x - cx, y: mid.y - cy }]),
    ...DIRS,
  ];
  let best: { x: number; y: number; gap: number } | null = null;
  const hereGap = nearestWallGap(cx, cy, bodyR + keep + 16);
  for (const dist of [keep * 0.5, keep, keep * 1.4, cell * 0.7]) {
    for (const h of dirs) {
      const len = Math.hypot(h.x, h.y);
      if (len < 0.01) continue;
      const nx = token.x + (h.x / len) * dist;
      const ny = token.y + (h.y / len) * dist;
      const pose = tryWorldFeet(token, map, nx, ny, items, radius, keep, ignoreKeep || byDoor);
      if (!pose) continue;
      const gap = nearestWallGap(pose.x + token.width / 2, pose.y + token.height / 2, bodyR + keep + 16);
      if (!byDoor && gap + 0.5 < hereGap) continue;
      if (!best || gap > best.gap) best = { ...pose, gap };
    }
  }
  if (best && Math.hypot(best.x - token.x, best.y - token.y) > 0.2) return best;
  const glen = Math.hypot(goalX - cx, goalY - cy) || 1;
  const fallX = byDoor ? token.x + ((goalX - cx) / glen) * cell * 0.25 : token.x + (mid.x - cx) * 0.08;
  const fallY = byDoor ? token.y + ((goalY - cy) / glen) * cell * 0.25 : token.y + (mid.y - cy) * 0.08;
  return tryWorldFeet(token, map, fallX, fallY, items, radius, 0, true);
}

function tokenWantsWander(token: TokenItem): boolean {
  return !token.locked && Boolean(token.wandering);
}

function nearestPathIndex(path: Array<{ x: number; y: number }>, x: number, y: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < path.length; i++) {
    const d = dist2(x, y, path[i]!.x, path[i]!.y);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function commitWanderPose(token: TokenItem, st: WanderState, now: number, persist: boolean): void {
  const { gridCol, gridRow } = worldToGridColRow(
    st.feetX + token.width / 2,
    st.feetY + token.height / 2,
    token.sizeCells,
  );
  applyWalkPoseVisual(token.id, st.feetX, st.feetY, st.yaw);
  if (persist || now - st.lastLive >= LIVE_EVERY_MS) {
    emitTokenLive(token.id, st.feetX, st.feetY, st.yaw, gridCol, gridRow);
    st.lastLive = now;
  }
  if (persist || now - st.lastCommit >= COMMIT_EVERY_MS) {
    emitTokenMove(token.id, gridCol, gridRow, st.feetX, st.feetY);
    emitTokenRotate(token.id, st.yaw);
    st.lastCommit = now;
  }
}

function doorExitGoal(token: TokenItem, door: ImageItem): { x: number; y: number } {
  const far = doorFarSide(token, door);
  const dest = mapUnderTokenFeet(far.x, far.y) ?? mapNearTokenFeet(far.x, far.y, 64);
  if (dest) return floorCenter(dest);
  return far;
}

function pickDoorGoal(
  token: TokenItem,
  doors: ImageItem[],
  smart: boolean,
  avoidId: string | null,
): { door: ImageItem; x: number; y: number } | null {
  const usable = doors.filter((d) => {
    if (d.id === avoidId) return false;
    if (smart) return true;
    return isDoorPropOpen(d);
  });
  if (usable.length === 0) return null;
  const pick = usable[Math.floor(Math.random() * usable.length)]!;
  const far = doorExitGoal(token, pick);
  return { door: pick, x: far.x, y: far.y };
}

function wanderKenneyClearance(floor: MapItem, wx: number, wy: number, cell: number): number {
  const kind = pieceForUrl(floor.modelUrl)?.kind;
  if (kind !== 'room' && kind !== 'hall') return cell * 4;
  const inset = cell * (kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const cx = floor.x + floor.width / 2;
  const cy = floor.y + floor.height / 2;
  const rad = (-floor.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.min(floor.width / 2 - inset - Math.abs(lx), floor.height / 2 - inset - Math.abs(ly));
}

function wanderClearance(wx: number, wy: number, cell: number, map: MapItem): number {
  if (inDoorLane(wx, wy, cell)) return cell;
  const floor = mapUnderTokenFeet(wx, wy) ?? map;
  return Math.min(
    nearestWallGap(wx, wy, cell * 2.2),
    wanderKenneyClearance(floor, wx, wy, cell),
  );
}

function wanderCellWalkable(wx: number, wy: number, cell: number): boolean {
  const floorHint = mapUnderTokenFeet(wx, wy) ?? mapNearTokenFeet(wx, wy, cell * 0.35);
  if (inDoorLane(wx, wy, cell, true)) return true;
  if (floorHint && isGeneratedDungeonMap(floorHint) && !generatedOpenAt(floorHint, wx, wy)) {
    return inDoorLane(wx, wy, cell);
  }
  const floor = floorHint;
  if (floor && isModularMap(floor)) {
    if (isModularWall(floor) && !isModularGate(floor)) return false;
    if (kenneyShellBlocks(floor, wx, wy, Math.max(8, floor.gridSize))) return false;
    const kind = pieceForUrl(floor.modelUrl)?.kind;
    if ((kind === 'room' || kind === 'hall') && inRoomWallRing(floor, wx, wy)) return false;
    if (wanderKenneyClearance(floor, wx, wy, cell) < cell * 0.2) return false;
  }
  if (wanderNavWalkAt(wx, wy)) return true;
  if (!floor || isModularWall(floor)) return false;
  if (wanderKenneyClearance(floor, wx, wy, cell) < cell * 0.2) return false;
  const kind = pieceForUrl(floor.modelUrl)?.kind;
  if ((kind === 'room' || kind === 'hall') && inRoomWallRing(floor, wx, wy)) return false;
  if (kenneyShellBlocks(floor, wx, wy, Math.max(8, floor.gridSize))) return false;
  if (isGeneratedDungeonMap(floor)) {
    return generatedOpenAt(floor, wx, wy);
  }
  if (bakedWalkableAt(floor.id, wx, wy)) return true;
  return kind === 'tile' || kind === 'room' || kind === 'hall' || kind === 'stairs' || !floor.modelUrl;
}

function bestClearStand(
  wx: number,
  wy: number,
  cell: number,
  map: MapItem,
): { x: number; y: number } {
  const inset = cell * (pieceForUrl(map.modelUrl)?.kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const step = cell * 0.45;
  let best: { x: number; y: number; score: number } | null = null;
  for (let y = map.y + inset; y <= map.y + map.height - inset; y += step) {
    for (let x = map.x + inset; x <= map.x + map.width - inset; x += step) {
      if (!wanderCellWalkable(x, y, cell)) continue;
      if (inDoorLane(x, y, cell)) continue;
      const gap = wanderClearance(x, y, cell, map);
      if (gap < cell * 0.35) continue;
      const d = Math.hypot(x - wx, y - wy);
      const score = gap * 4 - d * 0.15;
      if (!best || score > best.score) best = { x, y, score };
    }
  }
  if (best) return best;
  return nearestWalkable(wx, wy, cell, map) ?? wanderSafeStand(map, cell);
}

function nearestWalkable(
  wx: number,
  wy: number,
  cell: number,
  map: MapItem,
): { x: number; y: number } | null {
  if (wanderCellWalkable(wx, wy, cell)) return { x: wx, y: wy };
  const step = Math.max(12, cell * 0.35);
  for (let r = 1; r <= 14; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = wx + dx * step;
        const y = wy + dy * step;
        if (wanderCellWalkable(x, y, cell)) return { x, y };
      }
    }
  }
  const inset = cell * (pieceForUrl(map.modelUrl)?.kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const x0 = map.x + inset;
  const y0 = map.y + inset;
  const x1 = map.x + map.width - inset;
  const y1 = map.y + map.height - inset;
  let best: { x: number; y: number; d: number } | null = null;
  const coarse = cell * 0.5;
  for (let y = y0; y <= y1; y += coarse) {
    for (let x = x0; x <= x1; x += coarse) {
      if (!wanderCellWalkable(x, y, cell)) continue;
      const d = dist2(wx, wy, x, y);
      if (!best || d < best.d) best = { x, y, d };
    }
  }
  return best;
}

function wanderSafeStand(map: MapItem, cell: number): { x: number; y: number } {
  const fc = floorCenter(map);
  return nearestWalkable(fc.x, fc.y, cell, map) ?? fc;
}

function innerFloorGoal(map: MapItem): { x: number; y: number } {
  if (isGeneratedDungeonMap(map)) {
    const pick = generatedWanderGoal(map);
    if (pick) return pick;
  }
  const cell = Math.max(8, map.gridSize);
  const inset = cell * (pieceForUrl(map.modelUrl)?.kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const hits: Array<{ x: number; y: number }> = [];
  const step = cell * 0.55;
  for (let y = map.y + inset; y <= map.y + map.height - inset; y += step) {
    for (let x = map.x + inset; x <= map.x + map.width - inset; x += step) {
      if (wanderCellWalkable(x, y, cell)) hits.push({ x, y });
    }
  }
  if (hits.length > 0) {
    const pick = hits[Math.floor(Math.random() * hits.length)]!;
    return wanderNavSnap(pick.x, pick.y);
  }
  return wanderNavSnap(wanderSafeStand(map, cell).x, wanderSafeStand(map, cell).y);
}

function navMaps(map: MapItem, dest: MapItem | undefined, items: Record<string, Item>): MapItem[] {
  const pad = Math.max(8, map.gridSize) * 2.5;
  const seen = new Set<string>();
  const out: MapItem[] = [];
  const consider = (m: MapItem | undefined) => {
    if (!m || seen.has(m.id)) return;
    if (isModularWall(m)) return;
    seen.add(m.id);
    out.push(m);
  };
  consider(map);
  consider(dest);
  for (const it of Object.values(items)) {
    if (it.type !== 'map') continue;
    const kind = pieceForUrl(it.modelUrl)?.kind;
    if (kind === 'wall' || kind === 'gate') continue;
    if (it.x > map.x + map.width + pad || it.x + it.width < map.x - pad) continue;
    if (it.y > map.y + map.height + pad || it.y + it.height < map.y - pad) continue;
    consider(it);
  }
  if (dest) {
    for (const it of Object.values(items)) {
      if (it.type !== 'map') continue;
      const kind = pieceForUrl(it.modelUrl)?.kind;
      if (kind === 'wall' || kind === 'gate') continue;
      if (it.x > dest.x + dest.width + pad || it.x + it.width < dest.x - pad) continue;
      if (it.y > dest.y + dest.height + pad || it.y + it.height < dest.y - pad) continue;
      consider(it);
    }
  }
  return out;
}

function simplifyNav(pts: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
  if (pts.length <= 2) return pts;
  const out = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 4) out.push(b);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

function wanderFindPath(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  cell: number,
  maps: MapItem[],
): Array<{ x: number; y: number }> | null {
  for (const m of maps) {
    if (!isGeneratedDungeonMap(m)) continue;
    if (!generatedOpenAt(m, toX, toY)) continue;
    if (!generatedSegHitsWall(m, fromX, fromY, toX, toY)) {
      return [{ x: toX, y: toY }];
    }
  }
  const mapped = wanderNavPath(fromX, fromY, toX, toY);
  if (mapped && mapped.length > 0) return mapped;
  if (maps.length === 0) return null;
  const step = Math.max(16, cell * 0.5);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of maps) {
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + m.width);
    maxY = Math.max(maxY, m.y + m.height);
  }
  minX -= cell;
  minY -= cell;
  maxX += cell;
  maxY += cell;
  let gs = step;
  let cols = Math.ceil((maxX - minX) / gs) + 1;
  let rows = Math.ceil((maxY - minY) / gs) + 1;
  if (cols * rows > 2800) {
    gs = step * Math.sqrt((cols * rows) / 2800);
    cols = Math.ceil((maxX - minX) / gs) + 1;
    rows = Math.ceil((maxY - minY) / gs) + 1;
  }
  const walk = new Uint8Array(cols * rows);
  const at = (c: number, r: number) => r * cols + c;
  const world = (c: number, r: number) => ({ x: minX + c * gs, y: minY + r * gs });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = world(c, r);
      if (wanderCellWalkable(p.x, p.y, cell)) walk[at(c, r)] = 1;
    }
  }
  const toCell = (x: number, y: number) => ({
    c: Math.max(0, Math.min(cols - 1, Math.round((x - minX) / gs))),
    r: Math.max(0, Math.min(rows - 1, Math.round((y - minY) / gs))),
  });
  const nearestOpen = (c0: number, r0: number) => {
    if (walk[at(c0, r0)]) return { c: c0, r: r0 };
    for (let rad = 1; rad <= 12; rad++) {
      for (let dr = -rad; dr <= rad; dr++) {
        for (let dc = -rad; dc <= rad; dc++) {
          if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
          const c = c0 + dc;
          const r = r0 + dr;
          if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
          if (walk[at(c, r)]) return { c, r };
        }
      }
    }
    return null;
  };
  const start = nearestOpen(toCell(fromX, fromY).c, toCell(fromX, fromY).r);
  const goal = nearestOpen(toCell(toX, toY).c, toCell(toX, toY).r);
  if (!start || !goal) return null;
  if (start.c === goal.c && start.r === goal.r) return [{ x: toX, y: toY }];
  const parent = new Int32Array(cols * rows).fill(-1);
  const q = [start.c, start.r];
  parent[at(start.c, start.r)] = at(start.c, start.r);
  const nbr = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ] as const;
  let found = false;
  for (let qi = 0; qi < q.length && !found; ) {
    const c = q[qi++]!;
    const r = q[qi++]!;
    for (const [dc, dr] of nbr) {
      const nc = c + dc!;
      const nr = r + dr!;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = at(nc, nr);
      if (parent[ni] !== -1 || !walk[ni]) continue;
      if (dc !== 0 && dr !== 0 && !walk[at(c + dc, r)] && !walk[at(c, r + dr)]) continue;
      const pa = world(c, r);
      const pb = world(nc, nr);
      if (maps.some((m) => isGeneratedDungeonMap(m) && generatedSegHitsSolidWall(m, pa.x, pa.y, pb.x, pb.y))) continue;
      parent[ni] = at(c, r);
      if (nc === goal.c && nr === goal.r) {
        found = true;
        break;
      }
      q.push(nc, nr);
    }
  }
  if (!found) return null;
  const rev: Array<{ x: number; y: number }> = [];
  let i = at(goal.c, goal.r);
  const startI = at(start.c, start.r);
  while (i !== startI) {
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    rev.push(world(c, r));
    i = parent[i]!;
    if (i < 0) break;
  }
  rev.reverse();
  rev.push({ x: toX, y: toY });
  return simplifyNav(rev);
}

function clearNav(st: WanderState): void {
  st.nav = null;
  st.navKey = '';
}

function pickRoomGoal(
  token: TokenItem,
  current: MapItem,
  items: Record<string, Item>,
  avoidId: string | null,
  avoidFromId: string | null,
): { x: number; y: number; floorId: string } | null {
  const tx = token.x + token.width / 2;
  const ty = token.y + token.height / 2;
  const here = nearestRoom(items, tx, ty, current);
  const rooms = dungeonRooms(items).filter((m) => {
    if (m.id === current.id || m.id === here?.id) return false;
    return !roomWouldExceedGroups(m, token, items);
  });
  if (rooms.length === 0) return null;
  const cell = Math.max(8, current.gridSize);
  const home = here ?? current;
  let pool = rooms.filter((m) => m.id !== avoidId && m.id !== avoidFromId);
  if (pool.length === 0) pool = rooms.filter((m) => m.id !== avoidId);
  if (pool.length === 0) pool = rooms;
  const linked = pool.filter((m) => roomsLinked(home, m, items, cell));
  const ranked = (linked.length > 0 ? linked : pool).slice();
  ranked.sort((a, b) => {
    const ac = floorCenter(a);
    const bc = floorCenter(b);
    const crowd = groupsOnFloor(a, items, token.id).size - groupsOnFloor(b, items, token.id).size;
    return crowd * 1e12 + dist2(tx, ty, ac.x, ac.y) - dist2(tx, ty, bc.x, bc.y);
  });
  const choice = ranked[Math.floor(Math.random() * Math.min(3, ranked.length))]!;
  const c = innerFloorGoal(choice);
  return { x: c.x, y: c.y, floorId: choice.id };
}

function wanderAim(
  st: WanderState,
  map: MapItem,
  tx: number,
  ty: number,
  items: Record<string, Item>,
  cell: number,
): { x: number; y: number } {
  const dest = st.goalFloorId ? items[st.goalFloorId] : undefined;
  if (!dest || dest.type !== 'map' || dest.id === map.id) {
    return { x: st.goalX, y: st.goalY };
  }
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (kind === 'tile' || kind === 'hall' || kind === 'stairs') {
    const hole = roomOpeningToward(map, dest, cell);
    if (hole) return { x: hole.x, y: hole.y };
    return { x: st.goalX, y: st.goalY };
  }
  const portal = portalToward(map, dest, tx, ty, items, cell);
  const hole = roomOpeningToward(map, dest, cell);
  const dc = floorCenter(dest);
  const thinX = portal?.thinX ?? hole?.thinX ?? Math.abs(dc.x - tx) >= Math.abs(dc.y - ty);
  const cx = portal?.cx ?? hole?.cx ?? edgeToward(map, dest).x;
  const cy = portal?.cy ?? hole?.cy ?? edgeToward(map, dest).y;
  const dir = thinX
    ? (Math.sign(dc.x - cx) || 1)
    : (Math.sign(dc.y - cy) || 1);
  const push = cell * 1.8;
  const through = hole
    ? { x: hole.x, y: hole.y }
    : thinX
      ? { x: cx + dir * push, y: cy }
      : { x: cx, y: cy + dir * push };
  const along = thinX ? Math.abs(ty - cy) : Math.abs(tx - cx);
  if (along <= cell * 0.4) return through;
  return { x: cx, y: cy };
}

function nudgeOffGeneratedWall(
  token: TokenItem,
  map: MapItem,
  cell: number,
): { x: number; y: number } | null {
  const cx = token.x + token.width / 2;
  const cy = token.y + token.height / 2;
  if (!generatedWallBlocksStand(map, cx, cy)) return null;
  const step = cell * 0.28;
  let best: { x: number; y: number; d: number } | null = null;
  for (const h of DIRS) {
    const posed = wanderTryStep(token, map, h.x * step, h.y * step, cell);
    if (!posed) continue;
    const px = posed.x + token.width / 2;
    const py = posed.y + token.height / 2;
    if (generatedWallBlocksStand(map, px, py)) continue;
    const d = dist2(px, py, cx, cy);
    if (!best || d < best.d) best = { x: posed.x, y: posed.y, d };
  }
  return best;
}

function wanderFeetOnFloor(token: TokenItem, x: number, y: number, cell: number): boolean {
  return wanderCellWalkable(x + token.width / 2, y + token.height / 2, cell);
}

function wanderTryStep(
  token: TokenItem,
  map: MapItem,
  dx: number,
  dy: number,
  cell: number,
  st?: WanderState,
): { x: number; y: number } | null {
  const cap = cell * 0.48;
  const span = Math.hypot(dx, dy);
  if (span < 0.15) return null;
  if (span > cap) {
    dx = (dx / span) * cap;
    dy = (dy / span) * cap;
  }
  const rawX = token.x + dx;
  const rawY = token.y + dy;
  const rawCx = rawX + token.width / 2;
  const rawCy = rawY + token.height / 2;
  const fromCx = token.x + token.width / 2;
  const fromCy = token.y + token.height / 2;
  const door = doorInLaneAt(rawCx, rawCy, cell) ?? doorInLaneAt(fromCx, fromCy, cell);
  if (door && !isConcealedDoorProp(door) && isDoorPropClosed(door)) {
    openWanderPortal(door);
    if (st) {
      rememberOpenedDoor(st, door, fromCx, fromCy, cell, useItemStore.getState().items, token.id);
    }
  }
  if (isGeneratedDungeonMap(map)) {
    if (generatedSegHitsSolidWall(map, fromCx, fromCy, rawCx, rawCy)) return null;
    if (generatedOpenAt(map, rawCx, rawCy)) return { x: rawX, y: rawY };
    return null;
  }
  if (isModularMap(map)) {
    if (
      !solidKitWallsBlock(token, token.x, token.y, rawX, rawY)
      && (inDoorLane(rawCx, rawCy, cell, true) || wanderCellWalkable(rawCx, rawCy, cell) || wanderNavWalkAt(rawCx, rawCy))
    ) {
      return { x: rawX, y: rawY };
    }
    const slid = slideTokenFeet(token, map, token.x, token.y, dx, dy);
    const jumped = Math.hypot(slid.x - token.x, slid.y - token.y);
    if (jumped < 0.15) return null;
    let sx = slid.x;
    let sy = slid.y;
    if (jumped > cap) {
      sx = token.x + ((slid.x - token.x) / jumped) * cap;
      sy = token.y + ((slid.y - token.y) / jumped) * cap;
    }
    const wx = sx + token.width / 2;
    const wy = sy + token.height / 2;
    if (inDoorLane(wx, wy, cell, true) || wanderNavWalkAt(wx, wy) || wanderCellWalkable(wx, wy, cell)) {
      return { x: sx, y: sy };
    }
    return null;
  }
  if (door || inDoorLane(rawCx, rawCy, cell, true)) return { x: rawX, y: rawY };
  const slid = slideTokenFeet(token, map, token.x, token.y, dx, dy);
  const moved = Math.hypot(slid.x - token.x, slid.y - token.y);
  if (moved < 0.15) return null;
  const wx = slid.x + token.width / 2;
  const wy = slid.y + token.height / 2;
  if (inDoorLane(wx, wy, cell, true)) return slid;
  if (isGeneratedDungeonMap(map) && !generatedOpenAt(map, wx, wy)) return null;
  if (inDoorLane(wx, wy, cell) || wanderNavWalkAt(wx, wy)) return slid;
  if (isGeneratedDungeonMap(map) && generatedOpenAt(map, wx, wy)) return slid;
  if (!wanderFeetOnFloor(token, slid.x, slid.y, cell)) return null;
  return slid;
}

function wanderSlideAround(
  token: TokenItem,
  map: MapItem,
  gux: number,
  guy: number,
  step: number,
  st?: WanderState,
): { x: number; y: number } | null {
  const cell = Math.max(8, map.gridSize);
  const safe = bestClearStand(token.x + token.width / 2, token.y + token.height / 2, cell, map);
  const tries: Array<[number, number]> = [
    [safe.x - (token.x + token.width / 2), safe.y - (token.y + token.height / 2)],
    [gux + guy, guy - gux],
    [gux - guy, guy + gux],
    [guy, -gux],
    [-guy, gux],
  ];
  for (const h of DIRS) tries.push([h.x, h.y]);
  let best: { x: number; y: number; score: number } | null = null;
  for (const [dx, dy] of tries) {
    const len = Math.hypot(dx, dy) || 1;
    const posed = wanderTryStep(token, map, (dx / len) * step, (dy / len) * step, cell, st);
    if (!posed) continue;
    const mx = posed.x - token.x;
    const my = posed.y - token.y;
    const moved = Math.hypot(mx, my);
    const progress = mx * gux + my * guy;
    if (progress < 0.05) continue;
    const score = progress * 3 + moved;
    if (!best || score > best.score) best = { x: posed.x, y: posed.y, score };
  }
  return best;
}

function stepToken(token: TokenItem, now: number, dt: number): void {
  if (!tokenWantsWander(token)) {
    stateByToken.delete(token.id);
    return;
  }
  const fp = useFirstPersonStore.getState();
  if (fp.enabled && fp.tokenId === token.id) return;

  let st = stateByToken.get(token.id);
  const feetCx = (st?.feetX ?? token.x) + token.width / 2;
  const feetCy = (st?.feetY ?? token.y) + token.height / 2;
  const map = mapUnderTokenFeet(feetCx, feetCy)
    ?? mapUnderTokenFeet(token.x + token.width / 2, token.y + token.height / 2)
    ?? getActiveMap();
  if (!map) return;

  if (!st) {
    st = {
      dir: randDir(),
      yaw: token.rotation ?? 0,
      feetX: token.x,
      feetY: token.y,
      nextAt: now,
      lastLive: 0,
      lastCommit: 0,
      openedDoorId: null,
      openedTouched: false,
      lastDoorId: null,
      goalX: token.x + token.width / 2,
      goalY: token.y + token.height / 2,
      goalDoorId: null,
      goalFloorId: null,
      goalUntil: 0,
      lastMoved: true,
      pathIndex: 0,
      crossingId: null,
      crossingFromId: null,
      lastFloorId: null,
      stuckMs: 0,
      nav: null,
      navKey: '',
      storeX: token.x,
      storeY: token.y,
    };
    stateByToken.set(token.id, st);
    if (token.monsterId && token.monsterInt == null) void fillMonsterInt(token.id, token.monsterId);
    if (!token.encounterGroupId) stampMissingEncounterGroups([token.id]);
    const resumePath = tokenPatrolPath(token);
    if (resumePath) {
      st.pathIndex = nearestPathIndex(resumePath, token.x + token.width / 2, token.y + token.height / 2);
      const pt = resumePath[st.pathIndex]!;
      st.goalX = pt.x;
      st.goalY = pt.y;
      st.goalUntil = now + 30_000;
    }
  } else {
    const prevStoreX = st.storeX ?? st.feetX;
    const prevStoreY = st.storeY ?? st.feetY;
    const storeMoved = Math.hypot(token.x - prevStoreX, token.y - prevStoreY);
    const awayFromFeet = Math.hypot(token.x - st.feetX, token.y - st.feetY);
    // GM / player drag moved the store. Ignore token:move echoes of our own feet.
    if (storeMoved > 12 && awayFromFeet > Math.max(28, map.gridSize * 0.55)) {
      st.feetX = token.x;
      st.feetY = token.y;
    }
    st.storeX = token.x;
    st.storeY = token.y;
  }

  const live = { ...token, x: st.feetX, y: st.feetY } as TokenItem;

  const items = useItemStore.getState().items;
  const doors = doorsOnMap(items, map);
  const cell = Math.max(8, map.gridSize);
  const smart = tokenCanOperateDoors(live);
  const tx = live.x + live.width / 2;
  const ty = live.y + live.height / 2;

  const body = Math.min(token.width, token.height);
  if (isGeneratedDungeonMap(map) && generatedWallBlocksStand(map, tx, ty)) {
    const off = nudgeOffGeneratedWall(live, map, cell);
    if (off) {
      st.feetX = off.x;
      st.feetY = off.y;
      st.stuckMs = 0;
      st.lastMoved = true;
      commitWanderPose(live, st, now, false);
      return;
    }
  }
  if (st.openedDoorId) {
    const opened = items[st.openedDoorId];
    if (opened && (opened.type === 'image' || (opened.type === 'map' && isModularGate(opened)))) {
      const c = portalCenter(opened);
      if (dist2(tx, ty, c.x, c.y) < (cell * 1.05) ** 2) st.openedTouched = true;
      if (st.openedTouched && doorClearToClose(opened, tx, ty, cell, items, token.id)) {
        if (smart) closeWanderPortal(opened);
        st.openedDoorId = null;
        st.openedTouched = false;
        st.crossingId = null;
      }
    } else {
      st.openedDoorId = null;
      st.openedTouched = false;
    }
  }

  const patrol = tokenPatrolPath(live);
  const goalGone = st.goalDoorId != null && !items[st.goalDoorId];
  const atGoal = dist2(tx, ty, st.goalX, st.goalY) < (cell * 0.9) ** 2;
  const onGoalFloor = st.goalFloorId != null && map.id === st.goalFloorId;
  const inPortal = inDoorLane(tx, ty, cell) && inRoomWallRing(map, tx, ty);
  const settledInRoom = onGoalFloor && !inPortal && atGoal;
  const needDest = !st.goalFloorId && (atGoal || st.goalUntil === 0 || now > st.goalUntil);
  const goalFloorItem = st.goalFloorId ? items[st.goalFloorId] : undefined;
  const goalCrowded = !patrol
    && goalFloorItem?.type === 'map'
    && roomWouldExceedGroups(goalFloorItem, live, items);
  if (patrol) {
    if (st.pathIndex == null) st.pathIndex = 0;
    if (atGoal || now > st.goalUntil || st.goalUntil === 0) {
      if (atGoal) st.pathIndex = (st.pathIndex + 1) % patrol.length;
      const pt = patrol[st.pathIndex % patrol.length]!;
      st.goalDoorId = null;
      st.goalFloorId = null;
      st.goalX = pt.x;
      st.goalY = pt.y;
      st.goalUntil = now + 30_000;
    }
  } else if (
    !(st.goalFloorId && map.id !== st.goalFloorId)
    && (needDest || goalGone || settledInRoom || goalCrowded)
    && (!inPortal || needDest)
  ) {
    const nextFloor = isModularMap(map)
      ? pickRoomGoal(live, map, items, st.goalFloorId, st.crossingFromId ?? st.lastFloorId)
      : null;
    const nextDoor = nextFloor || isGeneratedDungeonMap(map)
      ? null
      : pickDoorGoal(live, doors, smart, st.lastDoorId);
    if (isGeneratedDungeonMap(map) && !nextFloor) {
      const leave = Math.random() < 0.85;
      let next = leave
        ? generatedFarGoal(map, tx, ty)
        : generatedOrbitNext(map, tx, ty);
      if (leave) {
        for (let i = 0; i < 8 && !wanderNavPath(tx, ty, next.x, next.y); i++) {
          next = generatedFarGoal(map, tx, ty);
        }
        if (!wanderNavPath(tx, ty, next.x, next.y)) {
          next = generatedOrbitNext(map, tx, ty);
        }
      }
      st.goalDoorId = null;
      st.goalFloorId = map.id;
      st.goalX = next.x;
      st.goalY = next.y;
      st.goalUntil = now + 10_000 + Math.random() * 6000;
    } else if (nextFloor) {
      st.lastFloorId = isModularRoom(map) ? map.id : (st.lastFloorId ?? map.id);
      st.goalDoorId = null;
      st.goalFloorId = nextFloor.floorId;
      st.goalX = nextFloor.x;
      st.goalY = nextFloor.y;
      st.crossingFromId = st.lastFloorId;
      st.crossingId = null;
    } else if (nextDoor) {
      st.goalDoorId = nextDoor.door.id;
      st.goalFloorId = null;
      st.goalX = nextDoor.x;
      st.goalY = nextDoor.y;
      st.lastDoorId = nextDoor.door.id;
    } else {
      const mid = innerFloorGoal(map);
      st.goalDoorId = null;
      st.goalFloorId = isModularRoom(map) ? map.id : null;
      st.goalX = mid.x;
      st.goalY = mid.y;
    }
    st.goalUntil = now + 14_000 + Math.random() * 8000;
  }

  const destMap = st.goalFloorId ? items[st.goalFloorId] : undefined;
  const destFloor = destMap?.type === 'map' ? destMap : undefined;
  const navKey = `${Math.round(st.goalX)},${Math.round(st.goalY)},${st.goalFloorId ?? ''}`;
  if (st.navKey !== navKey) {
    st.nav = wanderFindPath(tx, ty, st.goalX, st.goalY, cell, navMaps(map, destFloor, items));
    st.navKey = navKey;
  }
  while (st.nav && st.nav.length > 0 && dist2(tx, ty, st.nav[0]!.x, st.nav[0]!.y) < (cell * 0.4) ** 2) {
    st.nav.shift();
  }
  if (isGeneratedDungeonMap(map)) {
    const blocked = st.nav?.[0]
      && generatedSegHitsSolidWall(map, tx, ty, st.nav[0]!.x, st.nav[0]!.y, items)
      && !closedPortalOnWay(tx, ty, st.nav[0]!.x, st.nav[0]!.y, items, cell, body);
    if (blocked) {
      st.nav = wanderFindPath(tx, ty, st.goalX, st.goalY, cell, navMaps(map, destFloor, items));
    }
  }
  const way = st.nav?.[0];
  let aim = way ?? wanderAim(st, map, tx, ty, items, cell);
  if (smart) {
    const portal = closedPortalToPass(live, map, tx, ty, aim.x, aim.y, items, cell, body)
      ?? closedPortalOnWay(tx, ty, aim.x, aim.y, items, cell, body);
    if (portal && (atPortalThreshold(tx, ty, portal, cell, body)
      || dist2(tx, ty, portalCenter(portal).x, portalCenter(portal).y) <= (cell * 2.8) ** 2)) {
      openWanderPortal(portal);
      beginCrossing(st, live, map, portal, now);
    }
  }
  if (isGeneratedDungeonMap(map) && generatedSegHitsSolidWall(map, tx, ty, aim.x, aim.y, items)) {
    const door = closedPortalOnWay(tx, ty, aim.x, aim.y, items, cell, body);
    if (door && smart) {
      openWanderPortal(door);
      beginCrossing(st, live, map, door, now);
    } else {
      st.nav = wanderFindPath(tx, ty, st.goalX, st.goalY, cell, navMaps(map, destFloor, items));
      const next = st.nav?.[0];
      if (next && !generatedSegHitsSolidWall(map, tx, ty, next.x, next.y, items)) aim = next;
    }
  }

  if (isGeneratedDungeonMap(map) && generatedSegHitsSolidWall(map, tx, ty, aim.x, aim.y, items)) {
    aim = steerToDoorCenter(tx, ty, aim.x, aim.y, items, cell, map);
  }
  const glen = Math.hypot(aim.x - tx, aim.y - ty) || 1;
  const gux = (aim.x - tx) / glen;
  const guy = (aim.y - ty) / glen;
  const step = Math.min(cell * 0.42, WALK_CELLS_PER_SEC * cell * dt);
  const leashOn = !isGeneratedDungeonMap(map) && !isModularMap(map);
  if (leashOn && !inPortal && !wanderGuideNear(tx, ty, cell * 0.42)) {
    const safe = wanderGuideSnapToward(tx, ty, aim.x, aim.y);
    const progress = (safe.x - tx) * gux + (safe.y - ty) * guy;
    if (progress >= -2 && (safe.x !== tx || safe.y !== ty)) {
      const dxs = safe.x - tx;
      const dys = safe.y - ty;
      const slen = Math.hypot(dxs, dys) || 1;
      const pull = Math.min(step * 1.35, slen);
      live.x += (dxs / slen) * pull;
      live.y += (dys / slen) * pull;
      st.feetX = live.x;
      st.feetY = live.y;
    }
  } else if (
    leashOn
    && !inPortal
    && !wanderNavWalkAt(tx, ty)
    && !wanderFeetOnFloor(live, live.x, live.y, cell)
  ) {
    const safe = wanderGuideSnapToward(tx, ty, aim.x, aim.y);
    const progress = (safe.x - tx) * gux + (safe.y - ty) * guy;
    if (progress >= -2 && (safe.x !== tx || safe.y !== ty)) {
      const dxs = safe.x - tx;
      const dys = safe.y - ty;
      const slen = Math.hypot(dxs, dys) || 1;
      const pull = Math.min(step * 1.6, slen);
      live.x += (dxs / slen) * pull;
      live.y += (dys / slen) * pull;
      st.feetX = live.x;
      st.feetY = live.y;
    }
  }
  let posed = wanderTryStep(live, map, gux * step, guy * step, cell, st);
  if (!posed) {
    const blocking = closedPortalToPass(live, map, tx, ty, aim.x, aim.y, items, cell, body);
    if (blocking) {
      openWanderPortal(blocking);
      beginCrossing(st, live, map, blocking, now);
      posed = wanderTryStep(live, map, gux * step, guy * step, cell, st);
    }
  }
  if (!posed) posed = wanderSlideAround(live, map, gux, guy, step, st);
  if (posed) {
    const dx = posed.x - live.x;
    const dy = posed.y - live.y;
    const back = dx * gux + dy * guy;
    if (back < -0.4) posed = null;
  }
  if (posed) {
    const dx = posed.x - live.x;
    const dy = posed.y - live.y;
    const movedDist = Math.hypot(dx, dy);
    st.feetX = posed.x;
    st.feetY = posed.y;
    st.dir = dirToward(gux, guy);
    if (movedDist > 1.2) {
      st.yaw = lerpYaw(st.yaw, yawFromVec(gux, guy), 1 - Math.exp(-YAW_TURN_PER_SEC * dt / 90));
    }
    st.stuckMs = 0;
    st.lastMoved = true;
    commitWanderPose(live, st, now, false);
    return;
  }

  st.stuckMs = (st.stuckMs ?? 0) + dt * 1000;
  if (st.stuckMs > 400) {
    const nearby = closedPortalToPass(live, map, tx, ty, aim.x, aim.y, items, cell, body)
      ?? closedPortalOnWay(tx, ty, st.goalX, st.goalY, items, cell, body);
    if (nearby) {
      openWanderPortal(nearby);
      beginCrossing(st, live, map, nearby, now);
      st.stuckMs = 0;
      commitWanderPose(live, st, now, false);
      return;
    }
    const ahead = wanderGuideSnapToward(tx, ty, st.goalX, st.goalY);
    const fwd = (ahead.x - tx) * gux + (ahead.y - ty) * guy;
    if (fwd > 2) {
      const alen = Math.hypot(ahead.x - tx, ahead.y - ty) || 1;
      const posedFwd = wanderTryStep(
        live,
        map,
        ((ahead.x - tx) / alen) * step,
        ((ahead.y - ty) / alen) * step,
        cell,
        st,
      );
      if (posedFwd) {
        st.feetX = posedFwd.x;
        st.feetY = posedFwd.y;
        st.stuckMs = 0;
        st.lastMoved = true;
        commitWanderPose(live, st, now, false);
        return;
      }
    }
    if (isGeneratedDungeonMap(map) && !tokenPatrolPath(live) && st.stuckMs > 700) {
      st.nav = wanderFindPath(tx, ty, st.goalX, st.goalY, cell, navMaps(map, destFloor, items));
      st.navKey = `${Math.round(st.goalX)},${Math.round(st.goalY)},${st.goalFloorId ?? ''}`;
      if (st.stuckMs > 1800) {
        let next = generatedFarGoal(map, tx, ty);
        if (!wanderNavPath(tx, ty, next.x, next.y)) next = generatedOrbitNext(map, tx, ty);
        st.goalDoorId = null;
        st.goalFloorId = map.id;
        st.goalX = next.x;
        st.goalY = next.y;
        st.goalUntil = now + 14_000;
        st.nav = wanderFindPath(tx, ty, st.goalX, st.goalY, cell, navMaps(map, destFloor, items));
        st.navKey = `${Math.round(st.goalX)},${Math.round(st.goalY)},${st.goalFloorId ?? ''}`;
        st.stuckMs = 0;
      }
    }
    commitWanderPose(live, st, now, false);
    return;
  }

  if (patrol && now >= st.nextAt) {
    st.pathIndex = (st.pathIndex + 1) % patrol.length;
    const pt = patrol[st.pathIndex]!;
    st.goalDoorId = null;
    st.goalFloorId = null;
    st.goalX = pt.x;
    st.goalY = pt.y;
    st.goalUntil = now + 30_000;
    st.nextAt = now + 280;
  } else if (!patrol && !inPortal && !(st.goalFloorId && map.id !== st.goalFloorId) && now >= st.nextAt) {
    const nextFloor = isModularMap(map)
      ? pickRoomGoal(live, map, items, st.goalFloorId, st.crossingFromId ?? st.lastFloorId)
      : null;
    if (nextFloor) {
      st.lastFloorId = isModularRoom(map) ? map.id : (st.lastFloorId ?? map.id);
      st.goalDoorId = null;
      st.goalFloorId = nextFloor.floorId;
      st.goalX = nextFloor.x;
      st.goalY = nextFloor.y;
      st.crossingFromId = st.lastFloorId;
    } else if (isGeneratedDungeonMap(map)) {
      let next = generatedFarGoal(map, tx, ty);
      if (!wanderNavPath(tx, ty, next.x, next.y)) next = generatedOrbitNext(map, tx, ty);
      st.goalDoorId = null;
      st.goalFloorId = map.id;
      st.goalX = next.x;
      st.goalY = next.y;
    } else {
      const mid = innerFloorGoal(map);
      st.goalDoorId = null;
      st.goalFloorId = map.id;
      st.goalX = mid.x;
      st.goalY = mid.y;
    }
    st.goalUntil = now + 5000;
    st.nextAt = now + 200;
  }
  st.lastMoved = false;
}

/** Advance every wandering token. Returns how many are still flagged. */
export function tickWanderingMonsters(now = performance.now(), dt = 0.05): number {
  const items = useItemStore.getState().items;
  const stepDt = Math.max(0.008, Math.min(0.05, dt));
  let n = 0;
  for (const it of Object.values(items)) {
    if (it.type !== 'token' || !tokenWantsWander(it)) continue;
    n += 1;
    stepToken(it, now, stepDt);
  }
  for (const id of [...stateByToken.keys()]) {
    const it = items[id];
    if (!it || it.type !== 'token' || !tokenWantsWander(it)) stateByToken.delete(id);
  }
  return n;
}
