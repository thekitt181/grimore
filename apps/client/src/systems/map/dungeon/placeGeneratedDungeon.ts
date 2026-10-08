import { v4 as uuidv4 } from 'uuid';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd, emitItemUpdate } from '@/systems/scene/sceneSync';
import type { DungeonFloorLink, DungeonStairRef, HandoutItem, Item, MapItem } from '@/systems/scene/types';
import { focusSessionMap } from '@/systems/map/mapFocusSync';
import { generateDungeon, type DungeonOptions, type GeneratedDungeon } from './generateDungeon';
import { paintDungeonOffThread } from './paintDungeonImage';

export interface DungeonLevelPlacement {
  options: DungeonOptions;
  delveId?: string;
  floor?: number;
  /** How many floors this delve should contain. The last one only has stairs back up. */
  floorCount?: number;
  baseName?: string;
  from?: { mapId: string; col: number; row: number };
  /** When false, leave the camera where it is. */
  focus?: boolean;
}

function floorOptions(options: DungeonOptions): DungeonFloorLink['options'] {
  return {
    layout: options.layout,
    size: options.size,
    doors: options.doors,
    seed: options.seed >>> 0,
    motif: options.motif ?? 'mixed',
    corridors: options.corridors ?? 'straight',
    passages: options.passages ?? 'linked',
    deadEnds: options.deadEnds ?? 'few',
    stairs: options.stairs ?? 'down',
    key: options.key ?? 'full',
    secrets: options.secrets ?? 'few',
    cavern: options.cavern ?? 'natural',
  };
}

function floorSeed(seed: number, floor: number): number {
  let hash = (seed ^ Math.imul(floor, 0x9e3779b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

function stairRefs(dungeon: GeneratedDungeon, from?: { mapId: string }): DungeonStairRef[] {
  return dungeon.stairs.map((stair) => {
    const ref: DungeonStairRef = { col: stair.x, row: stair.y, direction: stair.direction };
    if (stair.direction === 'up' && from) ref.toMapId = from.mapId;
    return ref;
  });
}

/** Map-local pixel hit. Returns the stair index, or -1. */
export function stairIndexAt(map: MapItem, localX: number, localY: number): number {
  const link = map.dungeon;
  if (!link || link.cell <= 0) return -1;
  const scaleX = map.width / (link.cols * link.cell);
  const scaleY = map.height / (link.rows * link.cell);
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return -1;
  const col = localX / scaleX / link.cell;
  const row = localY / scaleY / link.cell;
  let best = -1;
  let bestDist = 0.9;
  link.stairs.forEach((stair, index) => {
    const dist = Math.hypot(stair.col + 0.5 - col, stair.row + 0.5 - row);
    if (dist < bestDist) {
      bestDist = dist;
      best = index;
    }
  });
  return best;
}

function findDelveFloor(delveId: string, floor: number): MapItem | undefined {
  for (const item of Object.values(useItemStore.getState().items)) {
    if (item.type === 'map' && item.dungeon?.delveId === delveId && item.dungeon.floor === floor) {
      return item;
    }
  }
  return undefined;
}

let lastStairTravel = 0;

/** Open the floor a stair leads to. Down stairs build the next level the first time. */
export function followDungeonStair(map: MapItem, index: number): void {
  const now = Date.now();
  if (now - lastStairTravel < 450) return;
  const link = map.dungeon;
  const stair = link?.stairs[index];
  if (!link || !stair) return;

  const linked = stair.toMapId ? useItemStore.getState().items[stair.toMapId] : undefined;
  const existing = linked?.type === 'map'
    ? linked
    : stair.direction === 'down'
      ? findDelveFloor(link.delveId, link.floor + 1)
      : stair.direction === 'up'
        ? findDelveFloor(link.delveId, link.floor - 1)
        : undefined;
  if (existing?.type === 'map') {
    lastStairTravel = now;
    if (existing.id !== stair.toMapId) {
      linkParentStair(map.id, stair.col, stair.row, existing.id);
    }
    focusSessionMap(existing.id, { fitToMap: true, select: true });
    return;
  }
  if (stair.direction !== 'down') return;

  lastStairTravel = now;
  const nextFloor = link.floor + 1;
  const planned = link.floorCount ?? 0;
  if (planned > 1 && nextFloor > planned) return;
  const dungeon = generateDungeon({
    ...link.options,
    seed: floorSeed(link.options.seed, nextFloor),
    stairs: planned > 1 && nextFloor === planned ? 'up' : 'both',
  });
  const placement: DungeonLevelPlacement = {
    options: link.options,
    delveId: link.delveId,
    floor: nextFloor,
    baseName: link.baseName,
    from: { mapId: map.id, col: stair.col, row: stair.row },
  };
  if (planned > 1) placement.floorCount = planned;
  void placeGeneratedDungeon(dungeon, placement).catch((error: unknown) => {
    console.error('Could not open the next dungeon floor', error);
  });
}

function linkParentStair(mapId: string, col: number, row: number, toMapId: string): void {
  const map = useItemStore.getState().items[mapId];
  if (!map || map.type !== 'map' || !map.dungeon) return;
  const stairs = map.dungeon.stairs.map((stair) =>
    stair.col === col && stair.row === row ? { ...stair, toMapId } : stair,
  );
  const dungeon: DungeonFloorLink = { ...map.dungeon, stairs };
  const patch = { dungeon } as Partial<Item>;
  useItemStore.getState().updateItem(mapId, patch);
  emitItemUpdate([{ id: mapId, patch }]);
}

/** Drop a generated dungeon on the table, with a GM-only key card beside it. */
export async function placeGeneratedDungeon(dungeon: GeneratedDungeon, level?: DungeonLevelPlacement): Promise<string | null> {
  await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  const backgroundUrl = await paintDungeonOffThread(dungeon);
  if (!backgroundUrl) return null;

  const maps = Object.values(useItemStore.getState().items).filter((item) => item.type === 'map');
  const rightEdge = Math.max(0, ...maps.map((map) => map.x + map.width));
  const width = dungeon.cols * dungeon.cell;
  const height = dungeon.rows * dungeon.cell;
  const mapId = uuidv4();
  const floorNumber = level?.floor ?? 1;
  const baseName = level?.baseName ?? dungeon.name;
  const title = floorNumber === 1 ? baseName : `${baseName} · Floor ${floorNumber}`;
  const dungeonLink: DungeonFloorLink = {
    delveId: level?.delveId ?? uuidv4(),
    floor: floorNumber,
    baseName,
    cols: dungeon.cols,
    rows: dungeon.rows,
    cell: dungeon.cell,
    options: floorOptions(level?.options ?? {
      layout: 'rooms',
      size: 'medium',
      doors: 'mixed',
      seed: 1,
      motif: dungeon.motif,
    }),
    stairs: stairRefs(dungeon, level?.from),
  };
  if (level?.floorCount) dungeonLink.floorCount = level.floorCount;

  const map: MapItem = {
    id: mapId,
    type: 'map',
    x: rightEdge + 80,
    y: 0,
    rotation: 0,
    width,
    height,
    zIndex: 0,
    locked: false,
    visible: true,
    backgroundUrl,
    gridSize: dungeon.cell,
    gridType: 'square',
    gridColor: 0x6b6258,
    gridOpacity: 0.16,
    gridOffsetX: 0,
    gridOffsetY: 0,
    showGrid: true,
    walls: dungeon.walls,
    dungeon: dungeonLink,
  };

  const handout: HandoutItem = {
    id: uuidv4(),
    type: 'handout',
    x: map.x + width + 24,
    y: map.y,
    rotation: 0,
    width: 280,
    height: 360,
    zIndex: 2,
    locked: false,
    visible: false,
    name: `${title} key`,
    compendiumItemId: 'dungeon-key',
    description: `${dungeon.keyText.replace(/^[^\n]*/, title)}\nClick a stair flight on the map to open that floor.`,
    source: 'Generated',
  };

  const store = useItemStore.getState();
  store.addItem(map);
  emitItemAdd(map);
  store.addItem(handout);
  emitItemAdd(handout);
  if (level?.from) linkParentStair(level.from.mapId, level.from.col, level.from.row, mapId);
  if (level?.focus !== false) focusSessionMap(mapId, { fitToMap: true, select: true });
  return mapId;
}

/** Build every floor of a delve. The bottom floor only has stairs back up. */
export async function placeDungeonFloors(base: DungeonOptions, floorCount: number): Promise<void> {
  const count = Math.min(8, Math.max(1, Math.floor(floorCount)));
  const delveId = uuidv4();
  let baseName: string | undefined;
  let from: { mapId: string; col: number; row: number } | undefined;
  for (let floor = 1; floor <= count; floor++) {
    const stairs = count === 1
      ? (base.stairs ?? 'down')
      : floor === count
        ? 'up' as const
        : floor === 1
          ? 'down' as const
          : 'both' as const;
    const dungeon = generateDungeon({
      ...base,
      seed: floor === 1 ? base.seed : floorSeed(base.seed, floor),
      stairs,
    });
    const placement: DungeonLevelPlacement = {
      options: base,
      delveId,
      floor,
      focus: floor === 1,
    };
    if (count > 1) placement.floorCount = count;
    if (baseName) placement.baseName = baseName;
    if (from) placement.from = from;
    const mapId = await placeGeneratedDungeon(dungeon, placement);
    if (!mapId) return;
    baseName = baseName ?? dungeon.name;
    const down = dungeon.stairs.find((stair) => stair.direction === 'down');
    from = down ? { mapId, col: down.x, row: down.y } : undefined;
  }
}
