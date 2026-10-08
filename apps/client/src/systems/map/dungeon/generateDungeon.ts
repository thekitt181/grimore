import type { WallSegment } from '@/systems/scene/types';

export type DungeonLayout = 'rooms' | 'cavern' | 'five-room';
export type DungeonSize = 'small' | 'medium' | 'large';
export type DoorStyle = 'open' | 'closed' | 'mixed';
export type DoorKind = 'open' | 'closed' | 'locked' | 'secret';
export type DungeonMotif = 'mixed' | 'crypt' | 'temple' | 'fortress' | 'mine' | 'ruin';
export type CorridorStyle = 'straight' | 'winding' | 'wide';
export type PassageStyle = 'sparse' | 'linked' | 'maze';
export type DeadEndStyle = 'none' | 'few' | 'many';
export type StairsStyle = 'none' | 'down' | 'up' | 'both';
export type KeyDetail = 'brief' | 'full' | 'stocked';
export type SecretStyle = 'none' | 'few' | 'many';
export type CavernOpenness = 'tight' | 'natural' | 'open';

export interface DungeonStair {
  x: number;
  y: number;
  direction: 'up' | 'down';
}

export interface DungeonOptions {
  layout: DungeonLayout;
  size: DungeonSize;
  doors: DoorStyle;
  seed: number;
  motif?: DungeonMotif;
  corridors?: CorridorStyle;
  passages?: PassageStyle;
  deadEnds?: DeadEndStyle;
  stairs?: StairsStyle;
  key?: KeyDetail;
  secrets?: SecretStyle;
  cavern?: CavernOpenness;
}

export interface DungeonRoom {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  notes: string[];
}

export interface GeneratedDungeon {
  name: string;
  cols: number;
  rows: number;
  cell: number;
  floor: Uint8Array;
  roomOf: Int16Array;
  doors: Map<string, DoorKind>;
  rooms: DungeonRoom[];
  stairs: DungeonStair[];
  walls: WallSegment[];
  keyText: string;
  motif: DungeonMotif;
}

const CELL = 64;

const ADJECTIVES = ['Ashen', 'Sunken', 'Hollow', 'Gilded', 'Briar', 'Cinder', 'Marble', 'Drowned', 'Quiet', 'Iron', 'Velvet', 'Broken'];
const NOUNS = ['Vault', 'Ossuary', 'Gallery', 'Cistern', 'Warren', 'Sanctum', 'Mine', 'Crypt', 'Hold', 'Labyrinth', 'Cloister', 'Foundry'];

const PURPOSES = ['Guard post', 'Storeroom', 'Shrine', 'Barracks', 'Archive', 'Prison', 'Workshop', 'Dining hall', 'Laboratory', 'Armory', 'Well chamber', 'Audience hall', 'Crypt niche', 'Collapsed hall', 'Infirmary'];
const FEATURES = ['cracked flagstones', 'a dripping ceiling', 'a faded mural', 'iron sconces', 'a pile of rubble', 'a faded mosaic', 'a row of pillars', 'a still pool', 'an empty cage', 'a stone altar', 'a weapon rack', 'scattered bones', 'pale fungus', 'a cold draft'];
const HAZARDS = ['a pressure plate', 'a tripwire', 'a sagging ceiling', 'slick moss', 'a swarm roosting overhead', 'a pocket of foul air', 'an illusionary wall', 'a rusted portcullis', 'a covered pit', 'a glyph cut into the floor'];
const TREASURES = ['a scatter of old coins', 'a locked chest', 'a jewel wedged in a niche', 'a forgotten weapon', 'a sealed scroll case', 'a small art object', 'nothing of value', 'a cache under a loose stone'];

const FIVE_ROLES = [
  { title: 'Entrance', note: 'The way in. Something makes it clear the place is not abandoned.' },
  { title: 'Puzzle', note: 'A problem that must be solved or bypassed before the dungeon opens up.' },
  { title: 'Setback', note: 'A trick, trap, or twist that punishes a rushed party.' },
  { title: 'Conflict', note: 'The main fight or the dungeon’s guardian.' },
  { title: 'Reward', note: 'The prize, and a reason to leave in a hurry.' },
];

interface FlavorTables {
  nouns: readonly string[];
  purposes: readonly string[];
  features: readonly string[];
  hazards: readonly string[];
  treasures: readonly string[];
}

const MOTIFS: Record<DungeonMotif, FlavorTables> = {
  mixed: {
    nouns: NOUNS,
    purposes: PURPOSES,
    features: FEATURES,
    hazards: HAZARDS,
    treasures: TREASURES,
  },
  crypt: {
    nouns: ['Ossuary', 'Crypt', 'Sepulcher', 'Barrow', 'Catacomb', 'Mausoleum'],
    purposes: ['Burial niche', 'Embalming room', 'Ossuary', 'Offerings chamber', 'Sealed tomb', 'Ancestor shrine', 'Bone pit', 'Weeping hall'],
    features: ['rows of sealed niches', 'a cracked sarcophagus', 'dust thick enough to show tracks', 'urns stacked in a corner', 'a name scraped off the wall', 'cold blue moss'],
    hazards: ['a curse mark on the lintel', 'a collapsing sarcophagus lid', 'a cloud of grave dust', 'a hidden spear niche', 'bones that shift underfoot', 'a whispering shadow'],
    treasures: ['funeral coins', 'a locket in a niche', 'a ceremonial blade', 'a sealed canopic jar', 'grave goods under a shroud', 'nothing but bone dust'],
  },
  temple: {
    nouns: ['Sanctum', 'Cloister', 'Reliquary', 'Chapel', 'Fane', 'Oratory'],
    purposes: ['Nave', 'Vestry', 'Reliquary', 'Font chamber', 'Choir', 'Penitent cell', 'Offering hall', 'Priest’s study'],
    features: ['a cracked altar', 'incense ash on the floor', 'a faded saint in mosaic', 'pews shoved aside', 'a dry font', 'votive candles burned to stubs'],
    hazards: ['a consecrated threshold', 'a bell rope that drops a grate', 'blinding incense smoke', 'a kneeling figure that is not stone', 'a hymn that will not stop'],
    treasures: ['a silver reliquary', 'offering coins in the font', 'a blessed weapon', 'a prayer book with a hollow cover', 'a gem set in the altar', 'melted candle stubs'],
  },
  fortress: {
    nouns: ['Hold', 'Barracks', 'Gatehouse', 'Armory', 'Keep', 'Redoubt'],
    purposes: ['Guard post', 'Barracks', 'Armory', 'Mess', 'Map room', 'Gatehouse', 'Cell block', 'Watch loft'],
    features: ['weapon racks', 'a cold hearth', 'scratched orders on the wall', 'bunks still made', 'an arrow slit', 'a dropped helm'],
    hazards: ['a murder hole', 'a portcullis chain', 'caltrops under a rug', 'a bell that still works', 'oil stains under a grate', 'a crossbow left cocked'],
    treasures: ['a pay chest', 'a officer’s seal', 'spare weapons', 'a map case', 'a ring of keys', 'empty ration tins'],
  },
  mine: {
    nouns: ['Mine', 'Delve', 'Shaft', 'Quarry', 'Works', 'Adit'],
    purposes: ['Ore face', 'Cart dock', 'Foreman’s room', 'Pump chamber', 'Store niche', 'Cave-in hall', 'Lift cage', 'Assay room'],
    features: ['cart rails', 'a dripping seam', 'broken picks', 'a timber prop', 'soot on the ceiling', 'a pool of mine water'],
    hazards: ['a rotten timber', 'bad air', 'a loose ore cart', 'a flooded step', 'a charge that never fired', 'a shaft with no rail'],
    treasures: ['a sack of ore', 'a miner’s stash', 'an uncut gem', 'tools worth keeping', 'a claim token', 'nothing but slag'],
  },
  ruin: {
    nouns: ['Ruin', 'Gallery', 'Manse', 'Archive', 'Court', 'Labyrinth'],
    purposes: ['Collapsed hall', 'Library', 'Solar', 'Kitchen', 'Courtyard well', 'Guest room', 'Scriptory', 'Garden crypt'],
    features: ['a fallen tapestry', 'roots through the masonry', 'a mosaic missing its center', 'soot from an old fire', 'furniture turned to mulch', 'a window open to stone'],
    hazards: ['a sagging floor', 'a nest in the rafters', 'rubble that shifts', 'an illusion of an intact room', 'a well with no bottom', 'ivy that grabs'],
    treasures: ['a family signet', 'coins in a cracked jar', 'a painting still in its frame', 'a forgotten spellbook', 'silverware in the ash', 'nothing the looters missed'],
  },
};

const MOTIF_LABEL: Record<DungeonMotif, string> = {
  mixed: 'Mixed',
  crypt: 'Crypt',
  temple: 'Temple',
  fortress: 'Fortress',
  mine: 'Mine',
  ruin: 'Ruin',
};

interface SizePreset {
  cols: number;
  rows: number;
  roomCount: [number, number];
  maxW: number;
  maxH: number;
}

const SIZES: Record<DungeonSize, SizePreset> = {
  small: { cols: 22, rows: 16, roomCount: [5, 7], maxW: 6, maxH: 5 },
  medium: { cols: 34, rows: 24, roomCount: [9, 13], maxW: 8, maxH: 6 },
  large: { cols: 46, rows: 32, roomCount: [14, 20], maxW: 9, maxH: 7 },
};

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

function randInt(rnd: () => number, min: number, max: number): number {
  return min + Math.floor(rnd() * (max - min + 1));
}

function edgeKey(x: number, y: number, nx: number, ny: number): string {
  if (nx > x || (nx === x && ny > y)) return `${x},${y},${nx > x ? 'e' : 's'}`;
  return `${nx},${ny},${x > nx ? 'e' : 's'}`;
}

function overlaps(a: DungeonRoom, b: DungeonRoom, gap: number): boolean {
  return a.x - gap < b.x + b.w
    && a.x + a.w + gap > b.x
    && a.y - gap < b.y + b.h
    && a.y + a.h + gap > b.y;
}

function placeRooms(
  cols: number,
  rows: number,
  count: number,
  maxW: number,
  maxH: number,
  rnd: () => number,
  gap = 2,
): DungeonRoom[] {
  const rooms: DungeonRoom[] = [];
  for (let attempt = 0; attempt < 400 && rooms.length < count; attempt++) {
    const w = randInt(rnd, 3, maxW);
    const h = randInt(rnd, 3, maxH);
    if (w + 2 >= cols || h + 2 >= rows) continue;
    const room: DungeonRoom = {
      id: rooms.length + 1,
      x: randInt(rnd, 1, cols - w - 2),
      y: randInt(rnd, 1, rows - h - 2),
      w,
      h,
      title: '',
      notes: [],
    };
    if (rooms.some((other) => overlaps(room, other, gap))) continue;
    rooms.push(room);
  }
  if (rooms.length === 0) {
    rooms.push({
      id: 1, x: 2, y: 2, w: Math.min(6, cols - 4), h: Math.min(5, rows - 4), title: '', notes: [],
    });
  }
  return rooms;
}

function center(room: DungeonRoom): { x: number; y: number } {
  return { x: room.x + Math.floor(room.w / 2), y: room.y + Math.floor(room.h / 2) };
}

function connectRooms(
  rooms: DungeonRoom[],
  rnd: () => number,
  chainOnly: boolean,
  extraLinks: number,
): Array<[number, number]> {
  const edges: Array<[number, number]> = [];
  if (rooms.length < 2) return edges;
  if (chainOnly) {
    for (let i = 0; i < rooms.length - 1; i++) edges.push([i, i + 1]);
  } else {
  const inTree = new Set<number>([0]);
  while (inTree.size < rooms.length) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const i of inTree) {
      for (let j = 0; j < rooms.length; j++) {
        if (inTree.has(j)) continue;
        const a = center(rooms[i]!);
        const b = center(rooms[j]!);
        const d = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
        if (d < bestD) {
          bestD = d;
          best = [i, j];
        }
      }
    }
    if (!best) break;
    edges.push(best);
    inTree.add(best[1]);
  }
  }
  for (let n = 0; n < extraLinks; n++) {
    const a = Math.floor(rnd() * rooms.length);
    let b = Math.floor(rnd() * rooms.length);
    if (b === a) b = (b + 1) % rooms.length;
    edges.push([a, b]);
  }
  return edges;
}

function rollDoor(rnd: () => number, style: DoorStyle, secrets: SecretStyle): DoorKind {
  if (secrets === 'many' && rnd() < (style === 'open' ? 0.16 : 0.3)) return 'secret';
  if (style === 'open') {
    if (secrets === 'few' && rnd() < 0.08) return 'secret';
    return 'open';
  }
  const roll = rnd();
  const kind: DoorKind = style === 'closed'
    ? (roll < 0.8 ? 'closed' : 'locked')
    : (roll < 0.4 ? 'open' : roll < 0.75 ? 'closed' : 'locked');
  if (secrets === 'few' && rnd() < 0.12) return 'secret';
  return kind;
}

function doorLabel(kind: DoorKind): string {
  if (kind === 'open') return 'open doorway';
  if (kind === 'closed') return 'closed door';
  if (kind === 'locked') return 'locked door';
  return 'secret door';
}

function sideName(from: { x: number; y: number }, to: { x: number; y: number }): string {
  if (to.x > from.x) return 'East';
  if (to.x < from.x) return 'West';
  if (to.y > from.y) return 'South';
  return 'North';
}

function appendLine(
  path: Array<{ x: number; y: number }>,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): void {
  const sx = Math.sign(x1 - x0);
  const sy = Math.sign(y1 - y0);
  let x = x0;
  let y = y0;
  if (path.length === 0) path.push({ x, y });
  while (x !== x1 || y !== y1) {
    if (x !== x1) x += sx;
    else y += sy;
    path.push({ x, y });
  }
}

function corridorPath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  style: CorridorStyle,
  rnd: () => number,
  cols: number,
  rows: number,
): Array<{ x: number; y: number }> {
  const path: Array<{ x: number; y: number }> = [];
  const straight = style !== 'winding' || a.x === b.x || a.y === b.y;
  if (straight) {
    if (rnd() < 0.5) {
      appendLine(path, a.x, a.y, b.x, a.y);
      appendLine(path, b.x, a.y, b.x, b.y);
    } else {
      appendLine(path, a.x, a.y, a.x, b.y);
      appendLine(path, a.x, b.y, b.x, b.y);
    }
    return path;
  }
  const split = 0.35 + rnd() * 0.3;
  const midX = Math.min(cols - 2, Math.max(1, a.x + Math.round((b.x - a.x) * split)));
  const midY = Math.min(rows - 2, Math.max(1, a.y + Math.round((b.y - a.y) * (1 - split))));
  if (rnd() < 0.5) {
    appendLine(path, a.x, a.y, midX, a.y);
    appendLine(path, midX, a.y, midX, midY);
    appendLine(path, midX, midY, b.x, midY);
    appendLine(path, b.x, midY, b.x, b.y);
  } else {
    appendLine(path, a.x, a.y, a.x, midY);
    appendLine(path, a.x, midY, midX, midY);
    appendLine(path, midX, midY, midX, b.y);
    appendLine(path, midX, b.y, b.x, b.y);
  }
  return path;
}

function carveLinks(
  cols: number,
  rows: number,
  floor: Uint8Array,
  roomOf: Int16Array,
  rooms: DungeonRoom[],
  links: Array<[number, number]>,
  doors: Map<string, DoorKind>,
  rnd: () => number,
  doorStyle: DoorStyle,
  secrets: SecretStyle,
  corridors: CorridorStyle,
): void {
  const index = (x: number, y: number) => y * cols + x;
  const inBounds = (x: number, y: number) => x >= 1 && y >= 1 && x < cols - 1 && y < rows - 1;

  const widen = (x: number, y: number, horizontal: boolean) => {
    if (corridors !== 'wide') return;
    const wx = horizontal ? x : x + 1;
    const wy = horizontal ? y + 1 : y;
    if (!inBounds(wx, wy) || roomOf[index(wx, wy)]) return;
    const neighbors = [[wx - 1, wy], [wx + 1, wy], [wx, wy - 1], [wx, wy + 1]];
    if (neighbors.some(([nx, ny]) => inBounds(nx!, ny!) && (roomOf[index(nx!, ny!)] ?? 0) > 0)) return;
    floor[index(wx, wy)] = 1;
  };

  for (const [ia, ib] of links) {
    const a = center(rooms[ia]!);
    const b = center(rooms[ib]!);
    const path = corridorPath(a, b, corridors, rnd, cols, rows);

    for (let i = 1; i < path.length; i++) {
      const prev = path[i - 1]!;
      const next = path[i]!;
      if (!inBounds(next.x, next.y)) continue;
      const prevRoom = roomOf[index(prev.x, prev.y)] ?? 0;
      const nextRoom = roomOf[index(next.x, next.y)] ?? 0;
      if (prevRoom !== nextRoom && (prevRoom > 0 || nextRoom > 0)) {
        const key = edgeKey(prev.x, prev.y, next.x, next.y);
        if (!doors.has(key)) {
          const kind = rollDoor(rnd, doorStyle, secrets);
          doors.set(key, kind);
          const roomId = prevRoom > 0 ? prevRoom : nextRoom;
          const room = rooms.find((r) => r.id === roomId);
          const from = prevRoom > 0 ? prev : next;
          const to = prevRoom > 0 ? next : prev;
          room?.notes.push(`${sideName(from, to)}: ${doorLabel(kind)}.`);
        }
      }
      if (nextRoom === 0) {
        floor[index(next.x, next.y)] = 1;
        widen(next.x, next.y, next.y === prev.y);
      }
    }
  }
}

const DEAD_DIRS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

function carveDeadEnds(
  cols: number,
  rows: number,
  floor: Uint8Array,
  roomOf: Int16Array,
  rooms: DungeonRoom[],
  doors: Map<string, DoorKind>,
  rnd: () => number,
  doorStyle: DoorStyle,
  secrets: SecretStyle,
  corridors: CorridorStyle,
  count: number,
): void {
  if (count <= 0 || rooms.length === 0) return;
  const index = (x: number, y: number) => y * cols + x;
  const inBounds = (x: number, y: number) => x >= 1 && y >= 1 && x < cols - 1 && y < rows - 1;
  let made = 0;
  for (let attempt = 0; attempt < count * 16 && made < count; attempt++) {
    const room = pick(rnd, rooms);
    const dir = pick(rnd, DEAD_DIRS);
    const x0 = dir.x > 0 ? room.x + room.w : dir.x < 0 ? room.x - 1 : randInt(rnd, room.x, room.x + room.w - 1);
    const y0 = dir.y > 0 ? room.y + room.h : dir.y < 0 ? room.y - 1 : randInt(rnd, room.y, room.y + room.h - 1);
    const length = randInt(rnd, 3, 6);
    const cells: Array<{ x: number; y: number }> = [];
    let blocked = false;
    for (let i = 0; i < length; i++) {
      const cx = x0 + dir.x * i;
      const cy = y0 + dir.y * i;
      if (!inBounds(cx, cy) || floor[index(cx, cy)] || roomOf[index(cx, cy)]) {
        blocked = true;
        break;
      }
      cells.push({ x: cx, y: cy });
    }
    if (blocked || cells.length < 3) continue;
    const inside = { x: cells[0]!.x - dir.x, y: cells[0]!.y - dir.y };
    if (!inBounds(inside.x, inside.y) || roomOf[index(inside.x, inside.y)] !== room.id) continue;
    const key = edgeKey(inside.x, inside.y, cells[0]!.x, cells[0]!.y);
    if (doors.has(key)) continue;
    const kind = rollDoor(rnd, doorStyle, secrets);
    doors.set(key, kind);
    room.notes.push(`${sideName(inside, cells[0]!)}: ${doorLabel(kind)} to a dead end.`);
    for (const cell of cells) floor[index(cell.x, cell.y)] = 1;
    if (corridors === 'wide') {
      for (const cell of cells) {
        const wx = dir.y !== 0 ? cell.x + 1 : cell.x;
        const wy = dir.x !== 0 ? cell.y + 1 : cell.y;
        if (!inBounds(wx, wy) || roomOf[index(wx, wy)]) continue;
        const touchesRoom = [[wx - 1, wy], [wx + 1, wy], [wx, wy - 1], [wx, wy + 1]]
          .some(([nx, ny]) => inBounds(nx!, ny!) && (roomOf[index(nx!, ny!)] ?? 0) > 0);
        if (touchesRoom) continue;
        floor[index(wx, wy)] = 1;
      }
    }
    made++;
  }
}

function largestCavern(cols: number, rows: number, wall: Uint8Array): Uint8Array {
  const seen = new Uint8Array(cols * rows);
  let best: number[] = [];
  const stack: number[] = [];
  for (let i = 0; i < wall.length; i++) {
    if (wall[i] || seen[i]) continue;
    const region: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      region.push(cur);
      const x = cur % cols;
      const y = (cur / cols) | 0;
      const next = [cur - 1, cur + 1, cur - cols, cur + cols];
      for (const n of next) {
        if (n < 0 || n >= wall.length || seen[n] || wall[n]) continue;
        const nx = n % cols;
        const ny = (n / cols) | 0;
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    if (region.length > best.length) best = region;
  }
  const floor = new Uint8Array(cols * rows);
  for (const i of best) floor[i] = 1;
  return floor;
}

function cavePass(cols: number, rows: number, rnd: () => number, fill: number, passes: number): Uint8Array {
  const wall = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const edge = x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
      wall[y * cols + x] = edge || rnd() < fill ? 1 : 0;
    }
  }
  for (let iter = 0; iter < passes; iter++) {
    const next = wall.slice();
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        let neighbors = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (wall[(y + dy) * cols + (x + dx)]) neighbors++;
          }
        }
        next[y * cols + x] = neighbors >= 5 ? 1 : 0;
      }
    }
    wall.set(next);
  }
  return largestCavern(cols, rows, wall);
}

function generateCavern(cols: number, rows: number, rnd: () => number, openness: CavernOpenness): Uint8Array {
  let fill = openness === 'tight' ? 0.52 : openness === 'open' ? 0.38 : 0.45;
  let passes = openness === 'tight' ? 5 : openness === 'open' ? 4 : 5;
  const need = Math.floor(cols * rows * (openness === 'open' ? 0.28 : 0.16));
  let best = cavePass(cols, rows, rnd, fill, passes);
  for (let attempt = 0; attempt < 3 && best.reduce((n, v) => n + v, 0) < need; attempt++) {
    fill = Math.max(0.34, fill - 0.05);
    passes = Math.max(3, passes - 1);
    const next = cavePass(cols, rows, rnd, fill, passes);
    if (next.reduce((n, v) => n + v, 0) > best.reduce((sum, v) => sum + v, 0)) best = next;
  }
  return best;
}

function buildWalls(
  cols: number,
  rows: number,
  cell: number,
  floor: Uint8Array,
  doors: Map<string, DoorKind>,
): WallSegment[] {
  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && floor[y * cols + x] === 1;

  const blocks = (x: number, y: number, nx: number, ny: number) => {
    const a = isFloor(x, y);
    const b = isFloor(nx, ny);
    const door = doors.get(edgeKey(x, y, nx, ny));
    if (a && b) return Boolean(door && door !== 'open');
    return a !== b;
  };

  const spans: Array<{ horizontal: boolean; fixed: number; start: number; end: number }> = [];
  const pushEdge = (x: number, y: number, nx: number, ny: number) => {
    if (!isFloor(x, y) || !blocks(x, y, nx, ny)) return;
    if (isFloor(nx, ny) && (nx < x || ny < y)) return;
    if (nx === x + 1) spans.push({ horizontal: false, fixed: (x + 1) * cell, start: y * cell, end: (y + 1) * cell });
    else if (nx === x - 1) spans.push({ horizontal: false, fixed: x * cell, start: y * cell, end: (y + 1) * cell });
    else if (ny === y + 1) spans.push({ horizontal: true, fixed: (y + 1) * cell, start: x * cell, end: (x + 1) * cell });
    else spans.push({ horizontal: true, fixed: y * cell, start: x * cell, end: (x + 1) * cell });
  };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      pushEdge(x, y, x, y - 1);
      pushEdge(x, y, x + 1, y);
      pushEdge(x, y, x, y + 1);
      pushEdge(x, y, x - 1, y);
    }
  }

  const groups = new Map<string, typeof spans>();
  for (const span of spans) {
    const key = `${span.horizontal ? 'h' : 'v'}:${span.fixed}`;
    const list = groups.get(key) ?? [];
    list.push(span);
    groups.set(key, list);
  }

  const walls: WallSegment[] = [];
  for (const list of groups.values()) {
    list.sort((a, b) => a.start - b.start);
    let current = { ...list[0]! };
    for (let i = 1; i < list.length; i++) {
      const next = list[i]!;
      if (next.start <= current.end + 0.01) current.end = Math.max(current.end, next.end);
      else {
        walls.push(spanToWall(current));
        current = { ...next };
      }
    }
    walls.push(spanToWall(current));
  }
  return walls;
}

function spanToWall(span: { horizontal: boolean; fixed: number; start: number; end: number }): WallSegment {
  if (span.horizontal) return { a: { x: span.start, y: span.fixed }, b: { x: span.end, y: span.fixed } };
  return { a: { x: span.fixed, y: span.start }, b: { x: span.fixed, y: span.end } };
}

function stairInRoom(room: DungeonRoom, stairs: DungeonStair[]): DungeonStair[] {
  return stairs.filter((stair) =>
    stair.x >= room.x && stair.x < room.x + room.w && stair.y >= room.y && stair.y < room.y + room.h);
}

function addContents(room: DungeonRoom, rnd: () => number, tables: FlavorTables, detail: KeyDetail): void {
  if (detail === 'brief') return;
  room.notes.push(`Feature: ${pick(rnd, tables.features)}.`);
  if (rnd() < (detail === 'stocked' ? 1 : 0.55)) room.notes.push(`Hazard: ${pick(rnd, tables.hazards)}.`);
  if (rnd() < (detail === 'stocked' ? 1 : 0.45)) room.notes.push(`Find: ${pick(rnd, tables.treasures)}.`);
}

function noteStairs(room: DungeonRoom, stairs: DungeonStair[]): void {
  for (const stair of stairInRoom(room, stairs)) {
    room.notes.unshift(stair.direction === 'up'
      ? 'Stairs lead back toward the surface.'
      : 'Stairs continue downward.');
  }
}

function describeRooms(
  rooms: DungeonRoom[],
  layout: DungeonLayout,
  rnd: () => number,
  motif: DungeonMotif,
  detail: KeyDetail,
  stairs: DungeonStair[],
): void {
  const tables = MOTIFS[motif];
  rooms.forEach((room, index) => {
    const downHere = stairInRoom(room, stairs).some((stair) => stair.direction === 'down');
    if (layout === 'five-room' && FIVE_ROLES[index]) {
      const role = FIVE_ROLES[index]!;
      room.title = role.title;
      room.notes.unshift(role.note);
    } else if (index === 0) {
      room.title = 'Entrance';
      room.notes.unshift('The way in.');
    } else if (downHere) {
      room.title = 'Stairs';
    } else {
      room.title = pick(rnd, tables.purposes);
    }
    noteStairs(room, stairs);
    addContents(room, rnd, tables, detail);
  });
}

function cavernNotes(
  cols: number,
  rows: number,
  floor: Uint8Array,
  rnd: () => number,
  motif: DungeonMotif,
  detail: KeyDetail,
  stairsStyle: StairsStyle,
): DungeonRoom[] {
  const tables = MOTIFS[motif];
  const spots: DungeonRoom[] = [];
  const wanted = 6;
  for (let n = 0; n < 80 && spots.length < wanted; n++) {
    const x = randInt(rnd, 2, cols - 3);
    const y = randInt(rnd, 2, rows - 3);
    if (!floor[y * cols + x]) continue;
    if (spots.some((s) => Math.abs(s.x - x) + Math.abs(s.y - y) < 6)) continue;
    const room: DungeonRoom = {
      id: spots.length + 1,
      x,
      y,
      w: 1,
      h: 1,
      title: pick(rnd, tables.purposes),
      notes: [],
    };
    addContents(room, rnd, tables, detail === 'brief' ? 'brief' : detail);
    if (detail === 'brief') room.notes.push(`Feature: ${pick(rnd, tables.features)}.`);
    spots.push(room);
  }
  if (spots[0]) {
    spots[0].title = 'Entrance';
    spots[0].notes.unshift('A crack opens into the cavern.');
  }
  const last = spots[spots.length - 1];
  if (last && spots.length > 1 && stairsStyle !== 'none') {
    last.title = 'Depths';
  }
  return spots;
}

function stairsForRooms(rooms: DungeonRoom[], style: StairsStyle): DungeonStair[] {
  if (style === 'none' || rooms.length === 0) return [];
  const first = rooms[0]!;
  const last = rooms[rooms.length - 1]!;
  const down: DungeonStair = {
    x: last.x + Math.floor((last.w - 1) / 2),
    y: last.y + Math.floor((last.h - 1) / 2),
    direction: 'down',
  };
  const up: DungeonStair = { x: first.x, y: first.y, direction: 'up' };
  if (style === 'down') return [down];
  if (style === 'up') return [up];
  if (up.x === down.x && up.y === down.y) {
    if (first.w > 1) up.x = first.x + first.w - 1;
    else if (last.w > 1) down.x = last.x + last.w - 1;
    else return [up];
  }
  return [up, down];
}

function writeKey(name: string, rooms: DungeonRoom[], subtitle: string, cellFeet = 5): string {
  const lines = [name, subtitle, ''];
  for (const room of rooms) {
    const feet = room.w > 1 ? `${room.w * cellFeet} × ${room.h * cellFeet} ft` : 'area';
    lines.push(`${room.id}. ${room.title} (${feet})`);
    for (const note of room.notes) lines.push(`   ${note}`);
    lines.push('');
  }
  lines.push('Closed, locked, and secret doors block vision. Open doorways do not.');
  lines.push('Secret doors are unmarked on the map and listed only here.');
  return lines.join('\n');
}

function extraLinksFor(roomCount: number, layout: DungeonLayout, passages: PassageStyle): number {
  if (layout === 'five-room') {
    if (passages === 'maze') return 2;
    if (passages === 'linked') return 1;
    return 0;
  }
  if (passages === 'sparse') return 0;
  const ratio = passages === 'maze' ? 0.55 : 0.22;
  return Math.max(1, Math.floor(roomCount * ratio));
}

function deadEndCount(roomCount: number, style: DeadEndStyle): number {
  if (style === 'none') return 0;
  if (style === 'many') return Math.max(2, Math.ceil(roomCount * 0.6));
  return Math.max(1, Math.ceil(roomCount * 0.25));
}

export function generateDungeon(options: DungeonOptions): GeneratedDungeon {
  const rnd = mulberry32(options.seed);
  const preset = SIZES[options.size];
  const motif = options.motif ?? 'mixed';
  const tables = MOTIFS[motif];
  const name = `${pick(rnd, ADJECTIVES)} ${pick(rnd, tables.nouns)}`;
  const detail = options.key ?? 'full';
  const stairsStyle = options.stairs ?? 'down';
  const subtitle = `${MOTIF_LABEL[motif]} · seed ${options.seed >>> 0}`;
  const chain = options.layout === 'five-room';
  const roomTarget = chain
    ? 5
    : randInt(rnd, preset.roomCount[0], preset.roomCount[1]);

  if (options.layout === 'cavern') {
    const floor = generateCavern(preset.cols, preset.rows, rnd, options.cavern ?? 'natural');
    const rooms = cavernNotes(preset.cols, preset.rows, floor, rnd, motif, detail, stairsStyle);
    const stairs = stairsForRooms(rooms, stairsStyle);
    for (const room of rooms) noteStairs(room, stairs);
    const doors = new Map<string, DoorKind>();
    return {
      name,
      cols: preset.cols,
      rows: preset.rows,
      cell: CELL,
      floor,
      roomOf: new Int16Array(preset.cols * preset.rows),
      doors,
      rooms,
      stairs,
      walls: buildWalls(preset.cols, preset.rows, CELL, floor, doors),
      keyText: writeKey(name, rooms, subtitle),
      motif,
    };
  }

  const corridors = options.corridors ?? 'straight';
  const secrets = options.secrets ?? 'few';
  const maxW = chain ? Math.max(preset.maxW, 6) : preset.maxW;
  const maxH = chain ? Math.max(preset.maxH, 5) : preset.maxH;
  let rooms = placeRooms(preset.cols, preset.rows, roomTarget, maxW, maxH, rnd, 2);
  if (rooms.length < roomTarget) {
    const retry = placeRooms(
      preset.cols,
      preset.rows,
      roomTarget,
      Math.max(4, maxW - 1),
      Math.max(3, maxH - 1),
      rnd,
      1,
    );
    if (retry.length > rooms.length) rooms = retry;
  }
  const floor = new Uint8Array(preset.cols * preset.rows);
  const roomOf = new Int16Array(preset.cols * preset.rows);
  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y++) {
      for (let x = room.x; x < room.x + room.w; x++) {
        floor[y * preset.cols + x] = 1;
        roomOf[y * preset.cols + x] = room.id;
      }
    }
  }
  const doors = new Map<string, DoorKind>();
  const passages = options.passages ?? 'linked';
  carveLinks(
    preset.cols,
    preset.rows,
    floor,
    roomOf,
    rooms,
    connectRooms(rooms, rnd, chain, extraLinksFor(rooms.length, options.layout, passages)),
    doors,
    rnd,
    options.doors,
    secrets,
    corridors,
  );
  carveDeadEnds(
    preset.cols,
    preset.rows,
    floor,
    roomOf,
    rooms,
    doors,
    rnd,
    options.doors,
    secrets,
    corridors,
    deadEndCount(rooms.length, options.deadEnds ?? 'few'),
  );
  const stairs = stairsForRooms(rooms, stairsStyle);
  describeRooms(rooms, options.layout, rnd, motif, detail, stairs);

  return {
    name,
    cols: preset.cols,
    rows: preset.rows,
    cell: CELL,
    floor,
    roomOf,
    doors,
    rooms,
    stairs,
    walls: buildWalls(preset.cols, preset.rows, CELL, floor, doors),
    keyText: writeKey(name, rooms, subtitle),
    motif,
  };
}
