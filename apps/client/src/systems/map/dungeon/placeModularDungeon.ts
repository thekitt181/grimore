import { v4 as uuidv4 } from 'uuid';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd, emitItemRemove } from '@/systems/scene/sceneSync';
import type { HandoutItem, MapItem } from '@/systems/scene/types';
import { focusSessionMap } from '@/systems/map/mapFocusSync';
import {
  footprintPx,
  isModularDeadEnd,
  modularGridDefaults,
  MODULAR_PX_PER_UNIT,
  pieceForUrl,
  type Cardinal,
} from '@/systems/map/library/modularKits';
import { bindMapBoundProp } from '@/systems/map/props/mapBoundProps';
import { buildFurnishingsInWorldRooms } from './dungeonPropSpawn';
import { spawnModularDungeonMonsters, type DungeonMonsterSpawnOpts } from './dungeonMonsterSpawn';
import {
  generateModularDungeon,
  generateModularExtension,
  modularGridPadCells,
  modularStrideCells,
  openingsWorld,
  type ExistingModularSlot,
  type GeneratedModularDungeon,
  type ModularDungeonOptions,
  type PlannedModularPiece,
} from './generateModularDungeon';

const CELL = 4 * MODULAR_PX_PER_UNIT;
const KISS = 4;

function monsterSpawnOpts(partyLevel?: number, theme?: string): DungeonMonsterSpawnOpts {
  const opts: DungeonMonsterSpawnOpts = {};
  if (partyLevel != null) opts.partyLevel = partyLevel;
  if (theme) opts.theme = theme;
  return opts;
}

function snapRot(deg: number): number {
  return ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
}

function cellOrigin(originX: number, originY: number, gx: number, gy: number): { x: number; y: number } {
  return { x: originX + gx * CELL, y: originY + gy * CELL };
}

function poseForPlan(
  plan: PlannedModularPiece,
  originX: number,
  originY: number,
): { x: number; y: number; width: number; height: number; rotation: number } {
  const fp = footprintPx(plan.piece, 1);
  const rot = snapRot(plan.rotation);
  const swap = rot === 90 || rot === 270;
  const worldW = swap ? fp.height : fp.width;
  const worldH = swap ? fp.width : fp.height;
  const cell = cellOrigin(originX, originY, plan.gx, plan.gy);

  if (plan.kind === 'wall' && plan.edge && plan.plugRoom) {
    return roomDoorPlugPose(fp, rot, worldW, worldH, cell, plan.edge, plan.cellsW, plan.cellsH);
  }
  if (plan.kind === 'wall' && plan.edge) {
    return wallPose(fp, rot, worldW, worldH, cell, plan.edge);
  }
  if (plan.kind === 'gate' && plan.edge) {
    return gatePose(fp, rot, cell, plan.edge);
  }

  const boxW = plan.cellsW * CELL;
  const boxH = plan.cellsH * CELL;
  const cx = cell.x + boxW / 2;
  const cy = cell.y + boxH / 2;
  return {
    x: cx - fp.width / 2,
    y: cy - fp.height / 2,
    width: fp.width,
    height: fp.height,
    rotation: rot,
  };
}

/** Center a 2 m wall slab on the Kenney room doorway so the hole is filled. */
function roomDoorPlugPose(
  fp: { width: number; height: number },
  rot: number,
  worldW: number,
  worldH: number,
  roomCell: { x: number; y: number },
  side: Cardinal,
  cellsW: number,
  cellsH: number,
): { x: number; y: number; width: number; height: number; rotation: number } {
  const boxW = cellsW * CELL;
  const boxH = cellsH * CELL;
  let cx = roomCell.x + boxW / 2;
  let cy = roomCell.y + boxH / 2;
  switch (side) {
    case 'N': cy = roomCell.y; break;
    case 'S': cy = roomCell.y + boxH; break;
    case 'W': cx = roomCell.x; break;
    case 'E': cx = roomCell.x + boxW; break;
  }
  return {
    x: cx - fp.width / 2,
    y: cy - fp.height / 2,
    width: fp.width,
    height: fp.height,
    rotation: rot,
  };
}

function wallPose(
  fp: { width: number; height: number },
  rot: number,
  worldW: number,
  worldH: number,
  cell: { x: number; y: number },
  edge: Cardinal,
): { x: number; y: number; width: number; height: number; rotation: number } {
  let wx = cell.x;
  let wy = cell.y;
  switch (edge) {
    case 'N':
      wx = cell.x + (CELL - worldW) / 2;
      wy = cell.y - worldH + KISS;
      break;
    case 'S':
      wx = cell.x + (CELL - worldW) / 2;
      wy = cell.y + CELL - KISS;
      break;
    case 'W':
      wx = cell.x - worldW + KISS;
      wy = cell.y + (CELL - worldH) / 2;
      break;
    case 'E':
      wx = cell.x + CELL - KISS;
      wy = cell.y + (CELL - worldH) / 2;
      break;
  }
  return {
    x: wx + worldW / 2 - fp.width / 2,
    y: wy + worldH / 2 - fp.height / 2,
    width: fp.width,
    height: fp.height,
    rotation: rot,
  };
}

function gatePose(
  fp: { width: number; height: number },
  rot: number,
  cell: { x: number; y: number },
  edge: Cardinal,
): { x: number; y: number; width: number; height: number; rotation: number } {
  let cx = cell.x + CELL / 2;
  let cy = cell.y + CELL / 2;
  switch (edge) {
    case 'E': cx = cell.x + CELL; break;
    case 'W': cx = cell.x; break;
    case 'S': cy = cell.y + CELL; break;
    case 'N': cy = cell.y; break;
  }
  return {
    x: cx - fp.width / 2,
    y: cy - fp.height / 2,
    width: fp.width,
    height: fp.height,
    rotation: rot,
  };
}

function zFor(kind: PlannedModularPiece['kind']): number {
  if (kind === 'wall' || kind === 'gate') return 3;
  if (kind === 'stairs') return 2;
  return 1;
}

function makeMap(
  plan: PlannedModularPiece,
  pose: { x: number; y: number; width: number; height: number; rotation: number },
): MapItem {
  return {
    id: uuidv4(),
    type: 'map',
    x: pose.x,
    y: pose.y,
    rotation: pose.rotation,
    width: pose.width,
    height: pose.height,
    zIndex: zFor(plan.kind),
    locked: false,
    visible: true,
    backgroundUrl: null,
    modelUrl: plan.piece.url,
    ...modularGridDefaults(),
    gridType: 'square',
    gridColor: 0x2a2a3a,
    gridOpacity: 0.8,
    showGrid: false,
    walls: [],
    ...(plan.kind === 'gate' ? { modularOpen: Boolean(plan.modularOpen), modularOpenAt: Date.now() } : {}),
  };
}

let lastModularOptions: ModularDungeonOptions | null = null;

export function rememberModularDungeonOptions(options: ModularDungeonOptions): void {
  lastModularOptions = { ...options };
}

function defaultExtendOptions(seed: number, kit: ModularDungeonOptions['kit']): ModularDungeonOptions {
  return {
    kit,
    layout: lastModularOptions?.layout ?? 'rooms',
    size: lastModularOptions?.size ?? 'tiny',
    furnishings: lastModularOptions?.furnishings ?? 'light',
    doors: lastModularOptions?.doors ?? 'mixed',
    stairs: lastModularOptions?.stairs ?? false,
    motif: lastModularOptions?.motif ?? 'mixed',
    seed,
    ...(lastModularOptions?.theme ? { theme: lastModularOptions.theme } : {}),
  };
}

const OPPOSITE: Record<Cardinal, Cardinal> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const STEP: Record<Cardinal, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

function containsPoint(map: MapItem, x: number, y: number): boolean {
  return x >= map.x && y >= map.y && x <= map.x + map.width && y <= map.y + map.height;
}

function nearCell(map: MapItem, x: number, y: number, slop: number): boolean {
  return Math.abs(map.x - x) <= slop && Math.abs(map.y - y) <= slop;
}

export function placeModularDungeonPieces(
  dungeon: GeneratedModularDungeon,
  originX: number,
  originY: number,
): { firstId: string | null; roomMaps: Array<{ map: MapItem; plan: PlannedModularPiece }> } {
  const store = useItemStore.getState();
  const roomMaps: Array<{ map: MapItem; plan: PlannedModularPiece }> = [];
  let firstId: string | null = null;
  for (const plan of dungeon.pieces) {
    const pose = poseForPlan(plan, originX, originY);
    const item = makeMap(plan, pose);
    store.addItem(item);
    emitItemAdd(item);
    firstId = firstId ?? item.id;
    if (plan.kind === 'room') roomMaps.push({ map: item, plan });
  }
  return { firstId, roomMaps };
}

function furnishPlacedRooms(
  roomMaps: Array<{ map: MapItem; plan: PlannedModularPiece }>,
  dungeon: GeneratedModularDungeon,
  seed: number,
): void {
  const store = useItemStore.getState();
  const furnish = buildFurnishingsInWorldRooms(
    roomMaps.map(({ map, plan }) => ({
      mapId: map.id,
      x: map.x,
      y: map.y,
      width: map.width,
      height: map.height,
      title: plan.roomTitle ?? 'Chamber',
      notes: plan.roomNotes ?? [],
    })),
    dungeon.motif,
    dungeon.furnishings,
    seed,
  );
  for (const prop of furnish) {
    const host = roomMaps.find((r) => r.map.id === prop.dungeonPropForMapId)?.map;
    const bound = host ? bindMapBoundProp(prop, host) : prop;
    store.addItem(bound);
    emitItemAdd(bound);
  }
}

export async function placeModularDungeon(
  options: ModularDungeonOptions,
  extras?: { monsters?: boolean; partyLevel?: number },
): Promise<string | null> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  rememberModularDungeonOptions(options);
  const dungeon: GeneratedModularDungeon = generateModularDungeon(options);
  if (dungeon.pieces.length === 0) return null;

  const maps = Object.values(useItemStore.getState().items).filter((i) => i.type === 'map');
  const rightEdge = Math.max(0, ...maps.map((m) => m.x + m.width));
  const originX = rightEdge + 80;
  const originY = 0;

  const { firstId, roomMaps } = placeModularDungeonPieces(dungeon, originX, originY);
  furnishPlacedRooms(roomMaps, dungeon, options.seed);
  if (extras?.monsters !== false) {
    await spawnModularDungeonMonsters(
      roomMaps.map(({ map, plan }) => ({
        map,
        mapId: map.id,
        x: map.x,
        y: map.y,
        width: map.width,
        height: map.height,
        title: plan.roomTitle ?? 'Chamber',
        notes: plan.roomNotes ?? [],
      })),
      dungeon.motif,
      options.seed,
      monsterSpawnOpts(extras?.partyLevel, dungeon.theme ?? options.theme),
    );
  }

  let minY = Infinity;
  let maxX = -Infinity;
  for (const { map } of roomMaps) {
    minY = Math.min(minY, map.y);
    maxX = Math.max(maxX, map.x + map.width);
  }

  const store = useItemStore.getState();
  const handout: HandoutItem = {
    id: uuidv4(),
    type: 'handout',
    x: (Number.isFinite(maxX) ? maxX : originX) + 24,
    y: Number.isFinite(minY) ? minY : originY,
    rotation: 0,
    width: 280,
    height: 360,
    zIndex: 2,
    locked: false,
    visible: false,
    name: `${dungeon.name} key`,
    compendiumItemId: 'dungeon-key',
    description: dungeon.keyText,
    source: 'Generated',
  };
  store.addItem(handout);
  emitItemAdd(handout);

  if (firstId) focusSessionMap(firstId, { fitToMap: true, select: true });
  return firstId;
}

export async function extendModularFromDeadEnd(deadEnd: MapItem): Promise<string | null> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  const piece = pieceForUrl(deadEnd.modelUrl);
  if (!piece || !isModularDeadEnd(deadEnd)) return null;
  const faces = openingsWorld(piece, deadEnd.rotation ?? 0);
  const towardRoom = faces[0];
  if (!towardRoom) return null;
  const expand = OPPOSITE[towardRoom];

  const cx = deadEnd.x + deadEnd.width / 2;
  const cy = deadEnd.y + deadEnd.height / 2;
  const probeX = cx + STEP[towardRoom].dx * CELL * 0.7;
  const probeY = cy + STEP[towardRoom].dy * CELL * 0.7;

  const maps = Object.values(useItemStore.getState().items).filter((i): i is MapItem => i.type === 'map');
  const parent = maps.find((m) => {
    if (m.id === deadEnd.id) return false;
    const p = pieceForUrl(m.modelUrl);
    return p?.kind === 'room' && p.kit === 'kenney' && containsPoint(m, probeX, probeY);
  });
  if (!parent) return null;
  const parentPiece = pieceForUrl(parent.modelUrl);
  if (!parentPiece) return null;

  const pad = modularGridPadCells();
  const stride = modularStrideCells();
  const originX = parent.x - pad * CELL;
  const originY = parent.y - pad * CELL;

  const existing: ExistingModularSlot[] = [];
  for (const m of maps) {
    const p = pieceForUrl(m.modelUrl);
    if (!p || p.kind !== 'room' || p.kit !== 'kenney') continue;
    const gx = Math.round((m.x - originX) / CELL);
    const gy = Math.round((m.y - originY) / CELL);
    if (Math.abs(m.x - (originX + gx * CELL)) > 8) continue;
    if (Math.abs(m.y - (originY + gy * CELL)) > 8) continue;
    if ((gx - pad) % stride !== 0 || (gy - pad) % stride !== 0) continue;
    existing.push({
      sx: (gx - pad) / stride,
      sy: (gy - pad) / stride,
      piece: p,
      rotation: m.rotation ?? 0,
    });
  }
  if (!existing.some((s) => s.sx === 0 && s.sy === 0)) {
    existing.push({
      sx: 0,
      sy: 0,
      piece: parentPiece,
      rotation: parent.rotation ?? 0,
    });
  }

  const hasKaykit = maps.some((m) => pieceForUrl(m.modelUrl)?.kit === 'kaykit');
  const seed = (Math.random() * 0xffffffff) >>> 0;
  const options = defaultExtendOptions(seed, hasKaykit || lastModularOptions?.kit === 'both' ? 'both' : 'kenney');
  const dungeon = generateModularExtension(options, expand, existing);
  if (dungeon.pieces.length === 0) return null;

  const removeIds: string[] = [];
  const slop = 12;
  for (const plan of dungeon.pieces) {
    if (plan.kind !== 'hall' && plan.kind !== 'gate' && plan.kind !== 'tile' && plan.kind !== 'wall') continue;
    const pose = poseForPlan(plan, originX, originY);
    for (const m of maps) {
      if (m.id === parent.id) continue;
      if (!nearCell(m, pose.x, pose.y, slop) && !nearCell(m, originX + plan.gx * CELL, originY + plan.gy * CELL, slop)) {
        continue;
      }
      const pk = pieceForUrl(m.modelUrl);
      if (!pk) continue;
      const replaceCap = pk.key === 'corridor-end' || pk.key === 'corridor-wide-end';
      const replaceHall = plan.kind === 'hall' && pk.kind === 'hall';
      const replaceKay = (plan.kind === 'tile' || plan.kind === 'wall') && pk.kit === 'kaykit' && (pk.kind === 'tile' || pk.kind === 'wall');
      if (replaceCap || replaceHall || replaceKay) {
        if (!removeIds.includes(m.id)) removeIds.push(m.id);
      }
    }
  }
  if (!removeIds.includes(deadEnd.id)) removeIds.push(deadEnd.id);

  const store = useItemStore.getState();
  if (removeIds.length > 0) {
    store.removeItems(removeIds);
    emitItemRemove(removeIds);
    store.select([], 'set');
  }

  const { firstId, roomMaps } = placeModularDungeonPieces(dungeon, originX, originY);
  furnishPlacedRooms(roomMaps, dungeon, options.seed);
  await spawnModularDungeonMonsters(
    roomMaps.map(({ map, plan }) => ({
      map,
      mapId: map.id,
      x: map.x,
      y: map.y,
      width: map.width,
      height: map.height,
      title: plan.roomTitle ?? 'Chamber',
      notes: plan.roomNotes ?? [],
    })),
    dungeon.motif,
    options.seed,
    monsterSpawnOpts(undefined, dungeon.theme ?? options.theme),
  );
  if (firstId) focusSessionMap(firstId, { fitToMap: false, select: true });
  return firstId;
}

export { isModularDeadEnd };
