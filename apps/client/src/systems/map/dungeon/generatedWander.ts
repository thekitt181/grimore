/**
 * Invisible walk graph for painted (red-wall) dungeon-generator maps.
 * Room + arms, corridor spines, door stubs — same idea as Kenney wanderGuide.
 */
import {
  distPointToWallSegment,
  mapLocalToWorld,
  wallBlocksMovement,
  worldToMapLocal,
} from '@/systems/map/fogLos';
import { isConcealedDoorProp, isDoorPropId, wanderMovementWalls } from '@/systems/map/props/doorCollision';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import { isModularMap } from '@/systems/map/library/modularKits';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Item, MapItem } from '@/systems/scene/types';
import { regenerateDungeonForMap } from './dungeonLayoutFromMap';
import type { GeneratedDungeon } from './generateDungeon';

export function isGeneratedDungeonMap(map: MapItem): boolean {
  return Boolean(map.dungeon) && !isModularMap(map);
}

type LayoutCache = { sig: string; gen: GeneratedDungeon };

let layoutCache: LayoutCache | null = null;

function layoutSig(map: MapItem): string {
  const d = map.dungeon;
  if (!d) return map.id;
  return `${map.id}:${d.floor}:${d.cols}x${d.rows}:${d.cell}:${d.options.seed}:${d.options.layout}:${d.options.size}:${d.rooms?.length ?? 0}`;
}

export function generatedLayout(map: MapItem): GeneratedDungeon | null {
  if (!map.dungeon) return null;
  const sig = layoutSig(map);
  if (!layoutCache || layoutCache.sig !== sig) {
    const gen = regenerateDungeonForMap(map);
    if (!gen) {
      layoutCache = null;
      return null;
    }
    layoutCache = { sig, gen };
  }
  return layoutCache.gen;
}

export function invalidateGeneratedWander(): void {
  layoutCache = null;
}

/** Painted cell size — map may have been scaled; never use a stale gridSize (that drifts tokens off the dungeon). */
export function generatedCellSize(map: MapItem, gen?: GeneratedDungeon | null): { cellX: number; cellY: number } {
  const cols = Math.max(1, map.dungeon?.cols ?? gen?.cols ?? 1);
  const rows = Math.max(1, map.dungeon?.rows ?? gen?.rows ?? 1);
  return {
    cellX: map.width / cols,
    cellY: map.height / rows,
  };
}

export function generatedFloorAtWorld(map: MapItem, wx: number, wy: number): boolean {
  const gen = generatedLayout(map);
  if (!gen) return false;
  const local = worldToMapLocal(wx, wy, map);
  const { cellX, cellY } = generatedCellSize(map, gen);
  const col = Math.floor(local.x / cellX);
  const row = Math.floor(local.y / cellY);
  if (col < 0 || row < 0 || col >= gen.cols || row >= gen.rows) return false;
  return gen.floor[row * gen.cols + col] === 1;
}

/** Wander hits the red *line*, not the token disc — any size still fits a 1-tile hall. */
export function generatedWanderBodyRadius(_map: MapItem): number {
  return 4;
}

function onAuthoredWallLine(map: MapItem, wx: number, wy: number): boolean {
  const local = worldToMapLocal(wx, wy, map);
  const r = 6;
  for (const wall of map.walls ?? []) {
    if (distPointToWallSegment(local, wall) < r) return true;
  }
  return false;
}

export function generatedWallBlocksStand(map: MapItem, wx: number, wy: number, items?: Record<string, Item>): boolean {
  if (generatedDoorwayAt(map, wx, wy, items)) return false;
  if (onAuthoredWallLine(map, wx, wy)) return true;
  return !generatedPaintedFloorAt(map, wx, wy);
}

export function generatedSegHitsWall(
  map: MapItem,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  items?: Record<string, Item>,
): boolean {
  const bag = items ?? useItemStore.getState().items;
  const from = worldToMapLocal(ax, ay, map);
  const to = worldToMapLocal(bx, by, map);
  return wallBlocksMovement(from, to, wanderMovementWalls(map, bag), generatedWanderBodyRadius(map));
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
  if (len2 < 1) return (px - ax) ** 2 + (py - ay) ** 2;
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const x = ax + abx * t;
  const y = ay + aby * t;
  return (px - x) ** 2 + (py - y) ** 2;
}

/** True when this step goes *through* a door opening — not along a wall that happens to be near one. */
function wanderPassableDoorOnSeg(
  map: MapItem,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  items: Record<string, Item>,
): boolean {
  const cell = Math.max(generatedCellSize(map).cellX, generatedCellSize(map).cellY);
  const mdx = bx - ax;
  const mdy = by - ay;
  for (const it of Object.values(items)) {
    if (it.type !== 'image') continue;
    if (!isDoorPropId(resolvePropId(it))) continue;
    if (it.visible === false && !isConcealedDoorProp(it)) continue;
    const cx = it.x + it.width / 2;
    const cy = it.y + it.height / 2;
    if (distPointToSeg2(cx, cy, ax, ay, bx, by) > (cell * 0.38) ** 2) continue;
    const rot = ((Math.round((it.rotation ?? 0) / 90) % 4) + 4) % 4;
    const swap = rot === 1 || rot === 3;
    const alongX = (swap ? it.height : it.width) >= (swap ? it.width : it.height);
    if (alongX) {
      if (Math.abs(mdy) < Math.abs(mdx) * 0.45) continue;
    } else if (Math.abs(mdx) < Math.abs(mdy) * 0.45) {
      continue;
    }
    return true;
  }
  return false;
}

/** Wall in the way that is not a normal door they can open. */
export function generatedSegHitsSolidWall(
  map: MapItem,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  items?: Record<string, Item>,
): boolean {
  const bag = items ?? useItemStore.getState().items;
  if (!generatedSegHitsWall(map, ax, ay, bx, by, bag)) return false;
  return !wanderPassableDoorOnSeg(map, ax, ay, bx, by, bag);
}

export function generatedRoomCenters(map: MapItem): Array<{ x: number; y: number; id: number }> {
  const gen = generatedLayout(map);
  const rooms = map.dungeon?.rooms?.length ? map.dungeon.rooms : gen?.rooms;
  if (!rooms?.length) return [];
  const { cellX, cellY } = generatedCellSize(map, gen);
  return rooms.map((room) => {
    const p = mapLocalToWorld((room.x + room.w / 2) * cellX, (room.y + room.h / 2) * cellY, map);
    return { x: p.x, y: p.y, id: room.id };
  });
}

function generatedPaintedFloorAt(map: MapItem, wx: number, wy: number): boolean {
  if (generatedFloorAtWorld(map, wx, wy)) return true;
  const local = worldToMapLocal(wx, wy, map);
  if (local.x < 0 || local.y < 0 || local.x > map.width || local.y > map.height) return false;
  const { cellX, cellY } = generatedCellSize(map);
  const col = Math.floor(local.x / cellX);
  const row = Math.floor(local.y / cellY);
  const rooms = map.dungeon?.rooms ?? generatedLayout(map)?.rooms ?? [];
  return inSavedRoom(rooms, col, row);
}

/** Opening a wanderer may cross (revealed door or secret, no reveal). */
export function generatedDoorwayAt(
  map: MapItem,
  wx: number,
  wy: number,
  items?: Record<string, Item>,
): boolean {
  const bag = items ?? useItemStore.getState().items;
  const cell = Math.max(generatedCellSize(map).cellX, generatedCellSize(map).cellY);
  for (const it of Object.values(bag)) {
    if (it.type !== 'image' || !isDoorPropId(resolvePropId(it))) continue;
    if (it.visible === false && !isConcealedDoorProp(it)) continue;
    const cx = it.x + it.width / 2;
    const cy = it.y + it.height / 2;
    const rot = ((Math.round((it.rotation ?? 0) / 90) % 4) + 4) % 4;
    const swap = rot === 1 || rot === 3;
    const w = swap ? it.height : it.width;
    const h = swap ? it.width : it.height;
    const alongX = w >= h;
    const along = Math.max(Math.max(w, h) * 0.42, cell * 0.38);
    const through = cell * 0.4;
    if (alongX) {
      if (Math.abs(wx - cx) <= along && Math.abs(wy - cy) <= through) return true;
    } else if (Math.abs(wy - cy) <= along && Math.abs(wx - cx) <= through) {
      return true;
    }
  }
  return false;
}

/** Tan floor that is not a red wall. Doorways are the only wall-line exception. */
export function generatedOpenAt(map: MapItem, wx: number, wy: number, items?: Record<string, Item>): boolean {
  if (generatedDoorwayAt(map, wx, wy, items)) return true;
  if (!generatedPaintedFloorAt(map, wx, wy)) return false;
  return !onAuthoredWallLine(map, wx, wy);
}

/**
 * Nav cells for this painted dungeon: tan floor + doorways.
 * Uses wall *line* thickness, not the token disc, so 1-tile halls stay connected.
 */
export function generatedNavCellOpen(
  map: MapItem,
  wx: number,
  wy: number,
  items?: Record<string, Item>,
): boolean {
  const bag = items ?? useItemStore.getState().items;
  if (generatedDoorwayAt(map, wx, wy, bag)) return true;
  if (!generatedPaintedFloorAt(map, wx, wy)) return false;
  if (onAuthoredWallLine(map, wx, wy)) return false;
  return true;
}

/** Random stand point in a room — anywhere off the red walls, not only the + center. */
export function generatedWanderGoal(map: MapItem): { x: number; y: number } | null {
  const rooms = map.dungeon?.rooms?.length
    ? map.dungeon.rooms
    : generatedLayout(map)?.rooms;
  if (!rooms?.length) return null;
  const { cellX, cellY } = generatedCellSize(map);
  const items = useItemStore.getState().items;
  const room = rooms[Math.floor(Math.random() * rooms.length)]!;
  const inset = 1;
  const x0 = room.x + inset;
  const y0 = room.y + inset;
  const x1 = room.x + room.w - inset;
  const y1 = room.y + room.h - inset;
  for (let i = 0; i < 14; i++) {
    const gx = x0 >= x1 ? room.x + room.w / 2 : x0 + Math.random() * Math.max(0.1, x1 - x0);
    const gy = y0 >= y1 ? room.y + room.h / 2 : y0 + Math.random() * Math.max(0.1, y1 - y0);
    const p = mapLocalToWorld(gx * cellX, gy * cellY, map);
    if (generatedOpenAt(map, p.x, p.y, items)) return p;
  }
  const c = mapLocalToWorld((room.x + room.w / 2) * cellX, (room.y + room.h / 2) * cellY, map);
  return c;
}

function roomsOf(map: MapItem) {
  return map.dungeon?.rooms?.length
    ? map.dungeon.rooms
    : generatedLayout(map)?.rooms ?? [];
}

function roomAtWorld(map: MapItem, wx: number, wy: number) {
  const rooms = roomsOf(map);
  const { cellX, cellY } = generatedCellSize(map);
  const local = worldToMapLocal(wx, wy, map);
  const col = Math.floor(local.x / cellX);
  const row = Math.floor(local.y / cellY);
  return rooms.find((r) => col >= r.x && col < r.x + r.w && row >= r.y && row < r.y + r.h) ?? null;
}

/** Clockwise loop inside a chamber so wanderers circle the open floor instead of stopping on the + end. */
export function generatedOrbitNext(
  map: MapItem,
  fromX: number,
  fromY: number,
): { x: number; y: number } {
  const items = useItemStore.getState().items;
  const rooms = roomsOf(map);
  const room = roomAtWorld(map, fromX, fromY)
    ?? rooms[Math.floor(Math.random() * Math.max(1, rooms.length))]
    ?? null;
  if (!room) return generatedWanderGoal(map) ?? { x: fromX, y: fromY };
  const { cellX, cellY } = generatedCellSize(map);
  const inset = Math.min(1.35, Math.max(0.8, Math.min(room.w, room.h) * 0.28));
  const x0 = room.x + inset;
  const y0 = room.y + inset;
  const x1 = room.x + room.w - inset;
  const y1 = room.y + room.h - inset;
  const raw: Array<{ gx: number; gy: number }> = [
    { gx: x0, gy: y0 },
    { gx: (x0 + x1) / 2, gy: y0 },
    { gx: x1, gy: y0 },
    { gx: x1, gy: (y0 + y1) / 2 },
    { gx: x1, gy: y1 },
    { gx: (x0 + x1) / 2, gy: y1 },
    { gx: x0, gy: y1 },
    { gx: x0, gy: (y0 + y1) / 2 },
  ];
  const pts: Array<{ x: number; y: number }> = [];
  for (const p of raw) {
    const w = mapLocalToWorld(p.gx * cellX, p.gy * cellY, map);
    if (generatedOpenAt(map, w.x, w.y, items)) pts.push(w);
  }
  if (pts.length === 0) return generatedWanderGoal(map) ?? { x: fromX, y: fromY };
  let nearest = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const d = (pts[i]!.x - fromX) ** 2 + (pts[i]!.y - fromY) ** 2;
    if (d < bestD) {
      bestD = d;
      nearest = i;
    }
  }
  const minD = Math.max(cellX, cellY) * 1.1;
  for (let k = 1; k <= pts.length; k++) {
    const p = pts[(nearest + k) % pts.length]!;
    if ((p.x - fromX) ** 2 + (p.y - fromY) ** 2 >= minD * minD) return p;
  }
  return pts[(nearest + 1) % pts.length]!;
}

/** Another chamber (or a far open cell) so wanderers leave this room and use the rest of the map. */
export function generatedFarGoal(map: MapItem, fromX: number, fromY: number): { x: number; y: number } {
  const items = useItemStore.getState().items;
  const rooms = roomsOf(map);
  const here = roomAtWorld(map, fromX, fromY);
  const { cellX, cellY } = generatedCellSize(map);
  const minD = Math.max(cellX, cellY) * 4;
  const hits: Array<{ x: number; y: number; d: number }> = [];
  for (const room of rooms) {
    if (here && room.id === here.id) continue;
    const p = mapLocalToWorld((room.x + room.w / 2) * cellX, (room.y + room.h / 2) * cellY, map);
    if (!generatedOpenAt(map, p.x, p.y, items)) continue;
    const d = Math.hypot(p.x - fromX, p.y - fromY);
    if (d >= minD) hits.push({ x: p.x, y: p.y, d });
  }
  const gen = generatedLayout(map);
  if (gen) {
    for (let n = 0; n < 48; n++) {
      const col = Math.floor(Math.random() * gen.cols);
      const row = Math.floor(Math.random() * gen.rows);
      if (gen.floor[row * gen.cols + col] !== 1) continue;
      if (here && col >= here.x && col < here.x + here.w && row >= here.y && row < here.y + here.h) continue;
      const p = mapLocalToWorld((col + 0.5) * cellX, (row + 0.5) * cellY, map);
      if (!generatedOpenAt(map, p.x, p.y, items)) continue;
      const d = Math.hypot(p.x - fromX, p.y - fromY);
      if (d >= minD) hits.push({ x: p.x, y: p.y, d });
    }
  }
  if (hits.length === 0) return generatedOrbitNext(map, fromX, fromY);
  hits.sort((a, b) => b.d - a.d);
  const pick = hits[Math.floor(Math.random() * Math.min(6, hits.length))]!;
  return { x: pick.x, y: pick.y };
}

type AddNode = (x: number, y: number) => number;
type AddEdge = (a: number, b: number) => void;

function inSavedRoom(
  rooms: Array<{ x: number; y: number; w: number; h: number }>,
  x: number,
  y: number,
): boolean {
  for (const r of rooms) {
    if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
  }
  return false;
}

function doorOnRoomSide(
  map: MapItem,
  room: { x: number; y: number; w: number; h: number },
  side: 'N' | 'E' | 'S' | 'W',
  cellX: number,
  cellY: number,
  items: Record<string, Item>,
): boolean {
  let x0 = 0;
  let y0 = 0;
  let x1 = 0;
  let y1 = 0;
  switch (side) {
    case 'E':
      x0 = (room.x + room.w) * cellX - cellX * 0.45;
      x1 = (room.x + room.w) * cellX + cellX * 0.45;
      y0 = room.y * cellY;
      y1 = (room.y + room.h) * cellY;
      break;
    case 'W':
      x0 = room.x * cellX - cellX * 0.45;
      x1 = room.x * cellX + cellX * 0.45;
      y0 = room.y * cellY;
      y1 = (room.y + room.h) * cellY;
      break;
    case 'S':
      y0 = (room.y + room.h) * cellY - cellY * 0.45;
      y1 = (room.y + room.h) * cellY + cellY * 0.45;
      x0 = room.x * cellX;
      x1 = (room.x + room.w) * cellX;
      break;
    default:
      y0 = room.y * cellY - cellY * 0.45;
      y1 = room.y * cellY + cellY * 0.45;
      x0 = room.x * cellX;
      x1 = (room.x + room.w) * cellX;
      break;
  }
  for (const it of Object.values(items)) {
    if (it.type !== 'image') continue;
    const id = resolvePropId(it);
    if (!isDoorPropId(id)) continue;
    if (it.visible === false && !isConcealedDoorProp(it)) continue;
    const c = worldToMapLocal(it.x + it.width / 2, it.y + it.height / 2, map);
    if (c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1) return true;
  }
  return false;
}

function roomOpensOnSide(
  map: MapItem,
  room: { id: number; x: number; y: number; w: number; h: number },
  side: 'N' | 'E' | 'S' | 'W',
  cellX: number,
  cellY: number,
  items: Record<string, Item>,
): boolean {
  if (doorOnRoomSide(map, room, side, cellX, cellY, items)) return true;
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  let ix = cx;
  let iy = cy;
  let ox = cx;
  let oy = cy;
  switch (side) {
    case 'E':
      ix = room.x + room.w - 1.15;
      ox = room.x + room.w + 0.45;
      iy = cy;
      oy = cy;
      break;
    case 'W':
      ix = room.x + 1.15;
      ox = room.x - 0.45;
      iy = cy;
      oy = cy;
      break;
    case 'S':
      iy = room.y + room.h - 1.15;
      oy = room.y + room.h + 0.45;
      ix = cx;
      ox = cx;
      break;
    default:
      iy = room.y + 1.15;
      oy = room.y - 0.45;
      ix = cx;
      ox = cx;
      break;
  }
  const a = mapLocalToWorld(ix * cellX, iy * cellY, map);
  const b = mapLocalToWorld(ox * cellX, oy * cellY, map);
  return !generatedSegHitsWall(map, a.x, a.y, b.x, b.y, items);
}

/** Build the same + / spine graph Kenney wanderers use, from generator floor + doors. */
export function appendGeneratedGuide(map: MapItem, addNode: AddNode, addEdge: AddEdge): void {
  const gen = generatedLayout(map);
  if (!gen) return;
  const { cellX, cellY } = generatedCellSize(map, gen);
  const worldCell = (col: number, row: number) =>
    mapLocalToWorld((col + 0.5) * cellX, (row + 0.5) * cellY, map);
  const rooms = map.dungeon?.rooms?.length ? map.dungeon.rooms : gen.rooms;
  const items = useItemStore.getState().items;
  const place = (x: number, y: number): number | null => {
    if (generatedWallBlocksStand(map, x, y, items)) return null;
    return addNode(x, y);
  };
  const link = (a: number | null, b: number | null, ax: number, ay: number, bx: number, by: number) => {
    if (a == null || b == null) return;
    if (generatedSegHitsSolidWall(map, ax, ay, bx, by, items)) return;
    addEdge(a, b);
  };

  const roomCenterId = new Map<number, number>();
  for (const room of rooms) {
    const c = mapLocalToWorld((room.x + room.w / 2) * cellX, (room.y + room.h / 2) * cellY, map);
    const cid = place(c.x, c.y);
    if (cid == null) continue;
    roomCenterId.set(room.id, cid);
    const lip = 1.15;
    const arms: Array<{ side: 'N' | 'E' | 'S' | 'W'; x: number; y: number }> = [
      { side: 'E', x: room.x + room.w - lip, y: room.y + room.h / 2 },
      { side: 'W', x: room.x + lip, y: room.y + room.h / 2 },
      { side: 'S', x: room.x + room.w / 2, y: room.y + room.h - lip },
      { side: 'N', x: room.x + room.w / 2, y: room.y + lip },
    ];
    for (const arm of arms) {
      if (!roomOpensOnSide(map, room, arm.side, cellX, cellY, items)) continue;
      const p = mapLocalToWorld(arm.x * cellX, arm.y * cellY, map);
      link(cid, place(p.x, p.y), c.x, c.y, p.x, p.y);
    }
  }

  const idx = (x: number, y: number) => y * gen.cols + x;
  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < gen.cols && y < gen.rows && gen.floor[idx(x, y)] === 1;
  const hallCell = (x: number, y: number) => isFloor(x, y) && !inSavedRoom(rooms, x, y);
  const n4 = (x: number, y: number) =>
    (isFloor(x + 1, y) ? 1 : 0)
    + (isFloor(x - 1, y) ? 1 : 0)
    + (isFloor(x, y + 1) ? 1 : 0)
    + (isFloor(x, y - 1) ? 1 : 0);
  const n8 = (x: number, y: number) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (isFloor(x + dx, y + dy)) n += 1;
      }
    }
    return n;
  };
  /** 1-wide halls / junctions only — never the interior of a chamber. */
  const hallSpine = (x: number, y: number) => hallCell(x, y) && n4(x, y) >= 1 && n8(x, y) <= 4;

  const hallAt = new Map<string, number>();
  for (let y = 0; y < gen.rows; y++) {
    for (let x = 0; x < gen.cols; x++) {
      if (!hallSpine(x, y)) continue;
      const p = worldCell(x, y);
      const id = place(p.x, p.y);
      if (id == null) continue;
      hallAt.set(`${x},${y}`, id);
    }
  }
  for (const [key, id] of hallAt) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const here = worldCell(x, y);
    const east = hallAt.get(`${x + 1},${y}`);
    const south = hallAt.get(`${x},${y + 1}`);
    if (east != null) {
      const there = worldCell(x + 1, y);
      link(id, east, here.x, here.y, there.x, there.y);
    }
    if (south != null) {
      const there = worldCell(x, y + 1);
      link(id, south, here.x, here.y, there.x, there.y);
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      if (!inSavedRoom(rooms, x + dx, y + dy)) continue;
      const room = rooms.find(
        (r) => x + dx >= r.x && x + dx < r.x + r.w && y + dy >= r.y && y + dy < r.y + r.h,
      );
      if (!room) continue;
      const cid = roomCenterId.get(room.id);
      if (cid == null) continue;
      const rc = mapLocalToWorld((room.x + room.w / 2) * cellX, (room.y + room.h / 2) * cellY, map);
      link(id, cid, here.x, here.y, rc.x, rc.y);
    }
  }

  for (const stair of gen.stairs) {
    if (!isFloor(stair.x, stair.y)) continue;
    const p = worldCell(stair.x, stair.y);
    place(p.x, p.y);
  }
}

