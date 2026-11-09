import {
  dungeonMotifTables,
  inferDungeonMotif,
  normalizeDungeonTheme,
  type DoorStyle,
  type DungeonMotif,
  type DungeonSize,
  type FurnishingStyle,
} from './generateDungeon';
import {
  type Cardinal,
  type ModularPiece,
  KAYKIT_PIECES,
  KENNEY_PIECES,
} from '@/systems/map/library/modularKits';

export type ModularKitMode = 'kenney' | 'both';
export type ModularLayout = 'rooms' | 'hub' | 'gauntlet';

export interface ModularDungeonOptions {
  kit: ModularKitMode;
  layout: ModularLayout;
  size: DungeonSize;
  furnishings: FurnishingStyle;
  doors: DoorStyle;
  stairs: boolean;
  motif: DungeonMotif;
  seed: number;
  theme?: string;
}

export interface PlannedModularPiece {
  piece: ModularPiece;
  gx: number;
  gy: number;
  rotation: number;
  cellsW: number;
  cellsH: number;
  modularOpen?: boolean;
  roomTitle?: string;
  roomNotes?: string[];
  edge?: Cardinal;
  plugRoom?: boolean;
  kind: ModularPiece['kind'];
}

export interface GeneratedModularDungeon {
  name: string;
  cols: number;
  rows: number;
  cellM: 4;
  pieces: PlannedModularPiece[];
  motif: DungeonMotif;
  furnishings: FurnishingStyle;
  keyText: string;
  theme?: string;
}

const ORDER: Cardinal[] = ['N', 'E', 'S', 'W'];
const OPPOSITE: Record<Cardinal, Cardinal> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const STEP: Record<Cardinal, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  E: { dx: 1, dy: 0 },
  S: { dx: 0, dy: 1 },
  W: { dx: -1, dy: 0 },
};

/** 12 m Kenney room (3 cells) + 1-cell street. Adjacent rooms share exactly one door cell. */
const STRIDE = 4;
const ROOM = 3;

const ADJECTIVES = ['Ashen', 'Sunken', 'Hollow', 'Gilded', 'Briar', 'Cinder', 'Iron', 'Quiet'];
const NOUNS = ['Vault', 'Warren', 'Sanctum', 'Hold', 'Cloister', 'Foundry', 'Crypt', 'Gallery'];

interface SlotSpec {
  sx: number;
  sy: number;
}

interface SizePreset {
  slotsX: number;
  slotsY: number;
  fill: number;
}

const SIZES: Record<DungeonSize, SizePreset> = {
  tiny: { slotsX: 3, slotsY: 2, fill: 0.9 },
  small: { slotsX: 4, slotsY: 3, fill: 0.7 },
  medium: { slotsX: 5, slotsY: 4, fill: 0.6 },
  large: { slotsX: 6, slotsY: 5, fill: 0.55 },
  huge: { slotsX: 7, slotsY: 6, fill: 0.5 },
  vast: { slotsX: 8, slotsY: 6, fill: 0.5 },
  mega: { slotsX: 8, slotsY: 7, fill: 0.45 },
};

interface ModRoom {
  id: number;
  sx: number;
  sy: number;
  title: string;
  notes: string[];
  doors: Set<Cardinal>;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, list: readonly T[]): T {
  return list[Math.floor(rnd() * list.length)]!;
}

/**
 * Map GLBs use +Y yaw (`degToRad(item.rotation)`), which is CCW from above.
 * Step the authored opening the same way so a 90° piece actually faces that door.
 */
function rotCard(side: Cardinal, rotDeg: number): Cardinal {
  const steps = ((Math.round(rotDeg / 90) % 4) + 4) % 4;
  return ORDER[(ORDER.indexOf(side) - steps + 4) % 4]!;
}

export function openingsWorld(piece: ModularPiece, rotDeg: number): Cardinal[] {
  return piece.openings.map((s) => rotCard(s, rotDeg));
}

function matchPiece(
  pool: ModularPiece[],
  world: Cardinal[],
): { piece: ModularPiece; rotation: number } | null {
  const want = new Set(world);
  if (want.size === 0) return null;
  for (const piece of pool) {
    for (const rot of [0, 90, 180, 270]) {
      const have = openingsWorld(piece, rot);
      if (have.length !== want.size) continue;
      if (have.every((s) => want.has(s))) return { piece, rotation: rot };
    }
  }
  return null;
}

function kenneyHalls(): ModularPiece[] {
  return KENNEY_PIECES.filter((p) => (
    p.kind === 'hall'
    && (p.key === 'corridor'
      || p.key === 'corridor-corner'
      || p.key === 'corridor-end'
      || p.key === 'corridor-intersection'
      || p.key === 'corridor-junction')
  ));
}

function corridorEnd(): ModularPiece {
  return KENNEY_PIECES.find((p) => p.key === 'corridor-end')!;
}

function roomOrigin(slot: SlotSpec): { gx: number; gy: number } {
  return { gx: 1 + slot.sx * STRIDE, gy: 1 + slot.sy * STRIDE };
}

function doorCell(slot: SlotSpec, dir: Cardinal): { x: number; y: number } {
  const { gx, gy } = roomOrigin(slot);
  const midX = gx + 1;
  const midY = gy + 1;
  switch (dir) {
    case 'N': return { x: midX, y: gy - 1 };
    case 'S': return { x: midX, y: gy + ROOM };
    case 'W': return { x: gx - 1, y: midY };
    case 'E': return { x: gx + ROOM, y: midY };
  }
}

function slotKey(sx: number, sy: number): string {
  return `${sx},${sy}`;
}

function facing(a: SlotSpec, b: SlotSpec): Cardinal | null {
  if (a.sy === b.sy && b.sx === a.sx + 1) return 'E';
  if (a.sy === b.sy && b.sx === a.sx - 1) return 'W';
  if (a.sx === b.sx && b.sy === a.sy + 1) return 'S';
  if (a.sx === b.sx && b.sy === a.sy - 1) return 'N';
  return null;
}

function neighbors4(sx: number, sy: number, slotsX: number, slotsY: number): SlotSpec[] {
  const out: SlotSpec[] = [];
  if (sx > 0) out.push({ sx: sx - 1, sy });
  if (sx + 1 < slotsX) out.push({ sx: sx + 1, sy });
  if (sy > 0) out.push({ sx, sy: sy - 1 });
  if (sy + 1 < slotsY) out.push({ sx, sy: sy + 1 });
  return out;
}

function neighbors4Open(sx: number, sy: number): SlotSpec[] {
  return [
    { sx: sx - 1, sy },
    { sx: sx + 1, sy },
    { sx, sy: sy - 1 },
    { sx, sy: sy + 1 },
  ];
}

/** 4-connected polyomino — every room shares a full wall with a neighbor. No diagonal paths. */
function growPolyomino(
  slotsX: number,
  slotsY: number,
  count: number,
  rnd: () => number,
  start: SlotSpec,
): SlotSpec[] {
  const want = Math.max(2, Math.min(count, slotsX * slotsY));
  const filled = new Set<string>([slotKey(start.sx, start.sy)]);
  const cells: SlotSpec[] = [{ ...start }];
  while (cells.length < want) {
    const frontier: SlotSpec[] = [];
    const seen = new Set<string>();
    for (const c of cells) {
      for (const n of neighbors4(c.sx, c.sy, slotsX, slotsY)) {
        const k = slotKey(n.sx, n.sy);
        if (filled.has(k) || seen.has(k)) continue;
        seen.add(k);
        frontier.push(n);
      }
    }
    if (frontier.length === 0) break;
    const next = frontier[Math.floor(rnd() * frontier.length)]!;
    filled.add(slotKey(next.sx, next.sy));
    cells.push(next);
  }
  return cells;
}

function flavorRoom(
  rnd: () => number,
  index: number,
  total: number,
  motif: DungeonMotif,
  theme?: string,
): Pick<ModRoom, 'title' | 'notes'> {
  const tables = dungeonMotifTables(motif);
  const lore = normalizeDungeonTheme(theme);
  const tag = lore ? [`Theme: ${lore}`] : [];
  if (index === 0) {
    return { title: 'Entrance', notes: ['The way in. A draft pulls toward the next door.', `Feature: ${pick(rnd, tables.features)}`, ...tag] };
  }
  if (index === total - 1) {
    return { title: 'Reward', notes: ['Find: a locked chest', `Feature: ${pick(rnd, tables.features)}`, ...tag] };
  }
  if (index === total - 2 && total >= 4) {
    return {
      title: 'Conflict',
      notes: ['The main fight or the dungeon’s guardian.', `Hazard: ${pick(rnd, tables.hazards)}`, ...tag],
    };
  }
  const notes = [`Feature: ${pick(rnd, tables.features)}`];
  if (rnd() > 0.45) notes.push(`Find: ${pick(rnd, tables.treasures)}`);
  if (rnd() > 0.7) notes.push(`Hazard: ${pick(rnd, tables.hazards)}`);
  notes.push(...tag);
  return { title: pick(rnd, tables.purposes), notes };
}

/**
 * Only Kenney rooms whose authored holes we can honor:
 * - 2 adjacent doors → corner room
 * - 4 doors → small room
 * - anything else → small/corner + corridor-end caps on leftover holes
 */
function kenneyRoomPiece(
  doors: Cardinal[],
  rnd: () => number,
  blocked: Cardinal[] = [],
): { piece: ModularPiece; rotation: number } {
  const corner = KENNEY_PIECES.find((p) => p.key === 'room-corner')!;
  const small = KENNEY_PIECES.filter((p) => p.key === 'room-small' || p.key === 'room-small-variation');
  const block = new Set(blocked.filter((d) => !doors.includes(d)));
  const leftoverClear = (piece: ModularPiece, rot: number): boolean => {
    const have = openingsWorld(piece, rot);
    if (!doors.every((d) => have.includes(d))) return false;
    return have.every((s) => !block.has(s));
  };
  if (doors.length === 2) {
    for (const rot of [0, 90, 180, 270]) {
      if (leftoverClear(corner, rot)) return { piece: corner, rotation: rot };
    }
    const hit = matchPiece([corner], doors);
    if (hit) return hit;
  }
  if (doors.length === 1) {
    for (const rot of [0, 90, 180, 270]) {
      if (leftoverClear(corner, rot)) return { piece: corner, rotation: rot };
    }
    for (const rot of [0, 90, 180, 270]) {
      if (openingsWorld(corner, rot).includes(doors[0]!)) return { piece: corner, rotation: rot };
    }
  }
  if (doors.length === 4) {
    return { piece: pick(rnd, small), rotation: 0 };
  }
  if (doors.length === 3) {
    return { piece: pick(rnd, small), rotation: 0 };
  }
  return { piece: pick(rnd, small), rotation: 0 };
}

function kenneyGate(rnd: () => number): ModularPiece {
  const doors = KENNEY_PIECES.filter((p) => p.key === 'gate-door' || p.key === 'gate-door-window');
  if (doors.length) return pick(rnd, doors);
  return pick(rnd, KENNEY_PIECES.filter((p) => p.kind === 'gate'));
}

/** Kenney gates pass N/S at rotation 0 (thin on Z). Turn 90° for E/W halls. */
function gateRotation(roomDoor: Cardinal): number {
  return roomDoor === 'E' || roomDoor === 'W' ? 90 : 0;
}

function corridorFloor(): ModularPiece {
  return KENNEY_PIECES.find((p) => p.key === 'template-floor')
    ?? KENNEY_PIECES.find((p) => p.kind === 'tile')!;
}

function kaykitWall(): ModularPiece {
  return KAYKIT_PIECES.find((p) => p.key === 'wall') ?? KAYKIT_PIECES.find((p) => p.kind === 'wall')!;
}

function assembleDungeonPieces(
  rooms: ModRoom[],
  options: Pick<ModularDungeonOptions, 'kit' | 'doors'>,
  rnd: () => number,
  opts?: {
    skipPlaceRoomIds?: Set<number>;
    existingPlans?: Map<number, PlannedModularPiece>;
    blockedDoors?: Map<number, Cardinal[]>;
  },
): PlannedModularPiece[] {
  const skip = opts?.skipPlaceRoomIds ?? new Set<number>();
  const existingPlans = opts?.existingPlans ?? new Map<number, PlannedModularPiece>();
  const blockedDoors = opts?.blockedDoors ?? new Map<number, Cardinal[]>();
  const pieces: PlannedModularPiece[] = [];
  const hallPool = kenneyHalls();
  const endCap = corridorEnd();
  const both = options.kit === 'both';
  const halls = new Set<string>();

  for (const a of rooms) {
    for (const b of rooms) {
      if (b.id <= a.id) continue;
      const dir = facing(a, b);
      if (!dir) continue;
      const aPlan = existingPlans.get(a.id);
      const bPlan = existingPlans.get(b.id);
      if (aPlan && !openingsWorld(aPlan.piece, aPlan.rotation).includes(dir)) continue;
      if (bPlan && !openingsWorld(bPlan.piece, bPlan.rotation).includes(OPPOSITE[dir])) continue;
      a.doors.add(dir);
      b.doors.add(OPPOSITE[dir]);
      const cell = doorCell(a, dir);
      halls.add(`${cell.x},${cell.y}`);
    }
  }

  for (const room of rooms) {
    if (skip.has(room.id)) continue;
    const blocked: Cardinal[] = [...(blockedDoors.get(room.id) ?? [])];
    for (const d of ORDER) {
      const nx = room.sx + STEP[d].dx;
      const ny = room.sy + STEP[d].dy;
      const other = rooms.find((r) => r.sx === nx && r.sy === ny);
      if (other && !room.doors.has(d) && !blocked.includes(d)) blocked.push(d);
    }
    blockedDoors.set(room.id, blocked);
  }

  for (const room of rooms) {
    const { gx, gy } = roomOrigin(room);
    const preset = existingPlans.get(room.id);
    if (preset) {
      continue;
    }
    if (skip.has(room.id)) continue;
    const { piece, rotation } = kenneyRoomPiece([...room.doors], rnd, blockedDoors.get(room.id) ?? []);
    pieces.push({
      piece,
      gx,
      gy,
      rotation,
      cellsW: ROOM,
      cellsH: ROOM,
      kind: 'room',
      roomTitle: room.title,
      roomNotes: room.notes,
    });
  }

  const roomAt = new Map<string, { room: ModRoom; piece: PlannedModularPiece }>();
  for (const room of rooms) {
    const { gx, gy } = roomOrigin(room);
    const preset = existingPlans.get(room.id);
    const plan = preset ?? pieces.find((p) => p.kind === 'room' && p.gx === gx && p.gy === gy);
    if (plan) roomAt.set(`${gx},${gy}`, { room, piece: plan });
  }

  function roomDoorFacesHall(hx: number, hy: number, dir: Cardinal): boolean {
    const nx = hx + STEP[dir].dx;
    const ny = hy + STEP[dir].dy;
    for (const { room, piece } of roomAt.values()) {
      const { gx, gy } = roomOrigin(room);
      if (nx < gx || ny < gy || nx >= gx + ROOM || ny >= gy + ROOM) continue;
      const authored = openingsWorld(piece.piece, piece.rotation);
      return authored.includes(OPPOSITE[dir]);
    }
    return false;
  }

  function hallOpenings(x: number, y: number): Cardinal[] {
    const open: Cardinal[] = [];
    for (const d of ORDER) {
      const nx = x + STEP[d].dx;
      const ny = y + STEP[d].dy;
      if (halls.has(`${nx},${ny}`) || roomDoorFacesHall(x, y, d)) open.push(d);
    }
    return open;
  }

  for (const key of [...halls]) {
    const [xs, ys] = key.split(',');
    const x = Number(xs);
    const y = Number(ys);
    const open = hallOpenings(x, y);
    if (open.length === 0) {
      halls.delete(key);
      continue;
    }
    if (both) {
      pieces.push({
        piece: corridorFloor(),
        gx: x,
        gy: y,
        rotation: 0,
        cellsW: 1,
        cellsH: 1,
        kind: 'tile',
      });
      const wall = kaykitWall();
      for (const d of ORDER) {
        if (open.includes(d)) continue;
        pieces.push({
          piece: wall,
          gx: x,
          gy: y,
          rotation: d === 'N' || d === 'S' ? 0 : 90,
          cellsW: 1,
          cellsH: 1,
          kind: 'wall',
          edge: d,
        });
      }
      continue;
    }
    const hit = matchPiece(hallPool, open);
    if (!hit) continue;
    pieces.push({
      piece: hit.piece,
      gx: x,
      gy: y,
      rotation: hit.rotation,
      cellsW: 1,
      cellsH: 1,
      kind: 'hall',
    });
  }

  const gateSeen = new Set<string>();
  for (const room of rooms) {
    if (skip.has(room.id)) continue;
    const placed = roomAt.get(`${roomOrigin(room).gx},${roomOrigin(room).gy}`)?.piece;
    if (!placed) continue;
    const authored = openingsWorld(placed.piece, placed.rotation);
    for (const d of authored) {
      const cell = doorCell(room, d);
      const ck = `${cell.x},${cell.y}`;
      const used = room.doors.has(d);
      if (used) {
        if (gateSeen.has(ck)) continue;
        gateSeen.add(ck);
        let open = false;
        if (options.doors === 'open') open = true;
        else if (options.doors === 'closed' || options.doors === 'locked') open = false;
        else open = rnd() > 0.5;
        pieces.push({
          piece: kenneyGate(rnd),
          gx: cell.x,
          gy: cell.y,
          rotation: gateRotation(d),
          cellsW: 1,
          cellsH: 1,
          kind: 'gate',
          modularOpen: open,
          edge: OPPOSITE[d],
        });
        continue;
      }
      const towardRoom = OPPOSITE[d];
      const cap = matchPiece([endCap], [towardRoom]);
      if (!cap) continue;
      pieces.push({
        piece: cap.piece,
        gx: cell.x,
        gy: cell.y,
        rotation: cap.rotation,
        cellsW: 1,
        cellsH: 1,
        kind: 'hall',
      });
    }
  }

  return pieces;
}

function resolveModularTheme(options: ModularDungeonOptions): { motif: DungeonMotif; theme: string } {
  const theme = normalizeDungeonTheme(options.theme);
  return {
    theme,
    motif: theme ? inferDungeonMotif(theme, options.motif) : options.motif,
  };
}

export function generateModularDungeon(options: ModularDungeonOptions): GeneratedModularDungeon {
  const rnd = mulberry32(options.seed >>> 0);
  const { motif, theme } = resolveModularTheme(options);
  const spec = SIZES[options.size] ?? SIZES.medium;
  let slotsX = spec.slotsX;
  let slotsY = spec.slotsY;
  if (options.layout === 'gauntlet') {
    slotsX = Math.max(3, Math.min(8, spec.slotsX + 1));
    slotsY = 1;
  }

  const cols = slotsX * STRIDE + 2;
  const rows = slotsY * STRIDE + 2;
  const target = Math.max(2, Math.round(slotsX * slotsY * spec.fill));

  let slots: SlotSpec[];
  if (options.layout === 'gauntlet') {
    slots = Array.from({ length: slotsX }, (_, sx) => ({ sx, sy: 0 }));
  } else if (options.layout === 'hub') {
    const start = { sx: Math.floor(slotsX / 2), sy: Math.floor(slotsY / 2) };
    slots = growPolyomino(slotsX, slotsY, target, rnd, start);
  } else {
    const start = { sx: Math.floor(rnd() * slotsX), sy: Math.floor(slotsY / 2) };
    slots = growPolyomino(slotsX, slotsY, target, rnd, start);
  }

  const occupied = new Set(slots.map((s) => slotKey(s.sx, s.sy)));
  const rooms: ModRoom[] = slots.map((s, i) => ({
    id: i + 1,
    sx: s.sx,
    sy: s.sy,
    doors: new Set(),
    ...flavorRoom(rnd, i, slots.length, motif, theme),
  }));
  const bySlot = new Map(rooms.map((r) => [slotKey(r.sx, r.sy), r]));

  for (const room of rooms) {
    for (const n of neighbors4(room.sx, room.sy, slotsX, slotsY)) {
      if (!occupied.has(slotKey(n.sx, n.sy))) continue;
      const other = bySlot.get(slotKey(n.sx, n.sy));
      if (!other || other.id <= room.id) continue;
      const dir = facing(room, other);
      if (!dir) continue;
      room.doors.add(dir);
      other.doors.add(OPPOSITE[dir]);
    }
  }

  const pieces = assembleDungeonPieces(rooms, options, rnd);

  const name = `${pick(rnd, ADJECTIVES)} ${pick(rnd, NOUNS)}`;
  const kitLabel = options.kit === 'both' ? 'Kenney + KayKit' : 'Kenney';
  const keyLines = [
    name,
    `${kitLabel} modular · ${options.layout} · ${options.size}`,
    '',
    ...rooms.map((r) => `• ${r.title}: ${r.notes.join(' ')}`),
  ];

  return {
    name,
    cols,
    rows,
    cellM: 4,
    pieces,
    motif,
    furnishings: options.furnishings,
    keyText: keyLines.join('\n'),
    ...(theme ? { theme } : {}),
  };
}

export interface ExistingModularSlot {
  sx: number;
  sy: number;
  piece: ModularPiece;
  rotation: number;
}

function growIntoEmpty(
  count: number,
  rnd: () => number,
  start: SlotSpec,
  blocked: Set<string>,
): SlotSpec[] {
  const filled = new Set<string>([slotKey(start.sx, start.sy)]);
  const cells: SlotSpec[] = [{ ...start }];
  while (cells.length < count) {
    const frontier: SlotSpec[] = [];
    const seen = new Set<string>();
    for (const c of cells) {
      for (const n of neighbors4Open(c.sx, c.sy)) {
        const k = slotKey(n.sx, n.sy);
        if (blocked.has(k) || filled.has(k) || seen.has(k)) continue;
        if (Math.abs(n.sx - start.sx) > 4 || Math.abs(n.sy - start.sy) > 4) continue;
        seen.add(k);
        frontier.push(n);
      }
    }
    if (frontier.length === 0) break;
    const next = frontier[Math.floor(rnd() * frontier.length)]!;
    filled.add(slotKey(next.sx, next.sy));
    cells.push(next);
  }
  return cells;
}

/** Grow new rooms off a parent slot (0,0) in `expand`, sealing leftover doors with corridor-end caps. */
export function generateModularExtension(
  options: ModularDungeonOptions,
  expand: Cardinal,
  existing: ExistingModularSlot[],
): GeneratedModularDungeon {
  const rnd = mulberry32(options.seed >>> 0);
  const { motif, theme } = resolveModularTheme(options);
  const parent = existing.find((s) => s.sx === 0 && s.sy === 0);
  const blocked = new Set(existing.map((s) => slotKey(s.sx, s.sy)));
  const start = { sx: STEP[expand].dx, sy: STEP[expand].dy };
  if (blocked.has(slotKey(start.sx, start.sy))) {
    return {
      name: 'Extension',
      cols: 0,
      rows: 0,
      cellM: 4,
      pieces: [],
      motif,
      furnishings: options.furnishings,
      keyText: '',
      ...(theme ? { theme } : {}),
    };
  }
  const want = 2 + Math.floor(rnd() * 3);
  const grown = growIntoEmpty(want, rnd, start, blocked);
  const existingPlans = new Map<number, PlannedModularPiece>();
  const skip = new Set<number>();
  const rooms: ModRoom[] = [];
  let nextId = 1;
  for (const slot of existing) {
    const id = nextId++;
    const { gx, gy } = roomOrigin(slot);
    rooms.push({
      id,
      sx: slot.sx,
      sy: slot.sy,
      doors: new Set(),
      title: 'Existing',
      notes: [],
    });
    skip.add(id);
    existingPlans.set(id, {
      piece: slot.piece,
      gx,
      gy,
      rotation: slot.rotation,
      cellsW: ROOM,
      cellsH: ROOM,
      kind: 'room',
    });
  }
  const newStartId = nextId;
  for (let i = 0; i < grown.length; i++) {
    const slot = grown[i]!;
    rooms.push({
      id: nextId++,
      sx: slot.sx,
      sy: slot.sy,
      doors: new Set(),
      ...flavorRoom(rnd, i, grown.length, motif, theme),
    });
  }
  const pieces = assembleDungeonPieces(rooms, options, rnd, {
    skipPlaceRoomIds: skip,
    existingPlans,
  });
  const newRooms = rooms.filter((r) => r.id >= newStartId);
  const name = `${pick(rnd, ADJECTIVES)} wing`;
  void parent;
  return {
    name,
    cols: 0,
    rows: 0,
    cellM: 4,
    pieces,
    motif,
    furnishings: options.furnishings,
    keyText: newRooms.map((r) => `• ${r.title}: ${r.notes.join(' ')}`).join('\n'),
    ...(theme ? { theme } : {}),
  };
}

export function modularGridPadCells(): number {
  return 1;
}

export function modularStrideCells(): number {
  return STRIDE;
}
