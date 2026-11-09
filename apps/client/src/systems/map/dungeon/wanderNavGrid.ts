/**
 * Occupancy map of the modular dungeon: inner floors, corridor centers, gate middles.
 * Wanderers BFS this grid so they do not walk into Kenney wall shells.
 */
import { doorWallsSignature } from '@/systems/map/props/doorCollision';
import {
  isModularGate,
  isModularWall,
  MODULAR_ROOM_WALL_CELLS,
  pieceForUrl,
} from '@/systems/map/library/modularKits';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Item, MapItem } from '@/systems/scene/types';
import { invalidateWanderGuide, wanderGuideNear, wanderGuidePath, wanderGuideSnap } from './wanderGuide';
import {
  generatedNavCellOpen,
  generatedOpenAt,
  generatedSegHitsSolidWall,
  invalidateGeneratedWander,
  isGeneratedDungeonMap,
} from './generatedWander';

export type NavPt = { x: number; y: number };

type WanderNav = {
  sig: string;
  cell: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  walk: Uint8Array;
  /** Bit 1 = east blocked by a wall, bit 2 = south blocked. */
  wallEdge: Uint8Array;
};

let cache: WanderNav | null = null;

function mapsSig(items: Record<string, Item>): string {
  const bits: string[] = [];
  for (const it of Object.values(items)) {
    if (it.type !== 'map') continue;
    bits.push(
      `${it.id}:${it.x}:${it.y}:${it.width}:${it.height}:${it.rotation ?? 0}:${it.modelUrl ?? ''}:${it.modularOpen ? 1 : 0}:${it.walls?.length ?? 0}:${it.dungeon ? doorWallsSignature(it, items) : ''}`,
    );
  }
  bits.sort();
  return bits.join('|');
}

function localXY(map: MapItem, wx: number, wy: number): { lx: number; ly: number } {
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-(map.rotation ?? 0) * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    lx: dx * Math.cos(rad) - dy * Math.sin(rad),
    ly: dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

function at(nav: WanderNav, c: number, r: number): number {
  return r * nav.cols + c;
}

function worldOf(nav: WanderNav, c: number, r: number): NavPt {
  return {
    x: nav.originX + (c + 0.5) * nav.cell,
    y: nav.originY + (r + 0.5) * nav.cell,
  };
}

function cellOf(nav: WanderNav, x: number, y: number): { c: number; r: number } {
  return {
    c: Math.max(0, Math.min(nav.cols - 1, Math.floor((x - nav.originX) / nav.cell))),
    r: Math.max(0, Math.min(nav.rows - 1, Math.floor((y - nav.originY) / nav.cell))),
  };
}

function mark(nav: WanderNav, wx: number, wy: number): void {
  const { c, r } = cellOf(nav, wx, wy);
  nav.walk[at(nav, c, r)] = 1;
}

const SIDES = ['N', 'E', 'S', 'W'] as const;
type Side = (typeof SIDES)[number];

function worldOpenings(map: MapItem): Side[] {
  const piece = pieceForUrl(map.modelUrl);
  if (!piece?.openings?.length) return [];
  const steps = ((Math.round((map.rotation ?? 0) / 90) % 4) + 4) % 4;
  return piece.openings.map((s) => SIDES[(SIDES.indexOf(s as Side) - steps + 4) % 4]!);
}

/** Centered strip from inner floor through the alcove so BFS can leave a room. */
function markOpeningLanes(nav: WanderNav, map: MapItem, cell: number): void {
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (kind !== 'room' && kind !== 'hall') return;
  const inner = cell * (kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const half = cell * 0.35;
  for (const side of worldOpenings(map)) {
    let x0 = cx;
    let y0 = cy;
    let x1 = cx;
    let y1 = cy;
    switch (side) {
      case 'E':
        x0 = map.x + map.width - inner;
        x1 = map.x + map.width + cell;
        y0 = cy;
        y1 = cy;
        break;
      case 'W':
        x0 = map.x + inner;
        x1 = map.x - cell;
        y0 = cy;
        y1 = cy;
        break;
      case 'S':
        y0 = map.y + map.height - inner;
        y1 = map.y + map.height + cell;
        x0 = cx;
        x1 = cx;
        break;
      default:
        y0 = map.y + inner;
        y1 = map.y - cell;
        x0 = cx;
        x1 = cx;
        break;
    }
    const dist = Math.hypot(x1 - x0, y1 - y0) || 1;
    const n = Math.max(4, Math.ceil(dist / (cell * 0.2)));
    const px = (-(y1 - y0) / dist) * half;
    const py = ((x1 - x0) / dist) * half;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      mark(nav, x, y);
      mark(nav, x + px, y + py);
      mark(nav, x - px, y - py);
    }
  }
}

function floorWalkable(map: MapItem, wx: number, wy: number, cell: number): boolean {
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (!kind || kind === 'wall') return false;
  const { lx, ly } = localXY(map, wx, wy);
  if (kind === 'gate') {
    const across = map.width <= map.height ? lx : ly;
    const along = map.width <= map.height ? ly : lx;
    const long = Math.max(map.width, map.height);
    return Math.abs(across) <= cell * 0.38 && Math.abs(along) <= long * 0.28;
  }
  if (kind === 'room') {
    // Kenney 12 m rooms: ~3.5 cell wall cap. Stay on the dark inner floor.
    const inset = cell * MODULAR_ROOM_WALL_CELLS;
    return Math.abs(lx) <= map.width / 2 - inset && Math.abs(ly) <= map.height / 2 - inset;
  }
  if (kind === 'hall') {
    // 4 m Kenney corridors: ~1.2 cell walls; keep the center strip only.
    const inset = cell * 1.25;
    return Math.abs(lx) <= map.width / 2 - inset && Math.abs(ly) <= map.height / 2 - inset;
  }
  if (kind === 'stairs' || kind === 'tile') {
    const inset = cell * 0.45;
    return Math.abs(lx) <= map.width / 2 - inset && Math.abs(ly) <= map.height / 2 - inset;
  }
  return false;
}

function thinWallHit(wall: MapItem, wx: number, wy: number, cell: number): boolean {
  if (!isModularWall(wall)) return false;
  if (isModularGate(wall)) return false;
  const key = pieceForUrl(wall.modelUrl)?.key ?? '';
  if (/doorway|gated|crossing|window_open/i.test(key)) return false;
  const short = Math.min(wall.width, wall.height);
  const long = Math.max(wall.width, wall.height);
  if (long / Math.max(1, short) < 1.35) return false;
  const { lx, ly } = localXY(wall, wx, wy);
  const across = wall.width <= wall.height ? lx : ly;
  const along = wall.width <= wall.height ? ly : lx;
  if (Math.abs(along) > long / 2) return false;
  return Math.abs(across) <= Math.min(short * 0.28, cell * 0.28);
}

function buildNav(items: Record<string, Item>): WanderNav | null {
  const maps = Object.values(items).filter(
    (i): i is MapItem => i.type === 'map' && (Boolean(i.modelUrl) || isGeneratedDungeonMap(i)),
  );
  if (maps.length === 0) return null;
  const cell = Math.max(8, maps[0]!.gridSize || 96);
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
  let cols = Math.ceil((maxX - minX) / cell);
  let rows = Math.ceil((maxY - minY) / cell);
  if (cols * rows > 12_000) {
    const s = Math.sqrt((cols * rows) / 12_000);
    cols = Math.ceil(cols / s);
    rows = Math.ceil(rows / s);
  }
  const nav: WanderNav = {
    sig: mapsSig(items),
    cell,
    originX: minX,
    originY: minY,
    cols,
    rows,
    walk: new Uint8Array(cols * rows),
    wallEdge: new Uint8Array(cols * rows),
  };

  const floors = maps.filter((m) => {
    if (isGeneratedDungeonMap(m)) return false;
    const k = pieceForUrl(m.modelUrl)?.kind;
    return k === 'room' || k === 'hall' || k === 'tile' || k === 'stairs' || k === 'gate';
  });
  const walls = maps.filter((m) => isModularWall(m) && !isModularGate(m));
  const painted = maps.filter((m) => isGeneratedDungeonMap(m));

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = worldOf(nav, c, r);
      let ok = false;
      for (const floor of floors) {
        if (floorWalkable(floor, p.x, p.y, cell)) {
          ok = true;
          break;
        }
      }
      if (!ok) continue;
      let blocked = false;
      for (const wall of walls) {
        if (thinWallHit(wall, p.x, p.y, cell)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) nav.walk[at(nav, c, r)] = 1;
    }
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = worldOf(nav, c, r);
      for (const map of painted) {
        if (p.x < map.x || p.y < map.y || p.x > map.x + map.width || p.y > map.y + map.height) continue;
        if (generatedNavCellOpen(map, p.x, p.y, items)) {
          nav.walk[at(nav, c, r)] = 1;
        } else {
          nav.walk[at(nav, c, r)] = 0;
        }
        break;
      }
    }
  }

  for (const floor of floors) markOpeningLanes(nav, floor, cell);

  for (const gate of maps.filter((m) => isModularGate(m))) {
    const cx = gate.x + gate.width / 2;
    const cy = gate.y + gate.height / 2;
    mark(nav, cx, cy);
    const thinX = gate.width <= gate.height;
    mark(nav, cx + (thinX ? 0 : cell), cy + (thinX ? cell : 0));
    mark(nav, cx - (thinX ? 0 : cell), cy - (thinX ? cell : 0));
  }

  if (painted.length > 0) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = at(nav, c, r);
        if (!nav.walk[i]) continue;
        const a = worldOf(nav, c, r);
        if (c + 1 < cols && nav.walk[at(nav, c + 1, r)]) {
          const b = worldOf(nav, c + 1, r);
          if (painted.some((map) => generatedSegHitsSolidWall(map, a.x, a.y, b.x, b.y, items))) {
            nav.wallEdge[i] |= 1;
          }
        }
        if (r + 1 < rows && nav.walk[at(nav, c, r + 1)]) {
          const b = worldOf(nav, c, r + 1);
          if (painted.some((map) => generatedSegHitsSolidWall(map, a.x, a.y, b.x, b.y, items))) {
            nav.wallEdge[i] |= 2;
          }
        }
      }
    }
  }

  return nav;
}

function nav(): WanderNav | null {
  const items = useItemStore.getState().items;
  const sig = mapsSig(items);
  if (!cache || cache.sig !== sig) cache = buildNav(items);
  return cache;
}

export function wanderNavWalkAt(wx: number, wy: number): boolean {
  const items = useItemStore.getState().items;
  for (const it of Object.values(items)) {
    if (it.type !== 'map' || !isGeneratedDungeonMap(it)) continue;
    if (wx < it.x || wy < it.y || wx > it.x + it.width || wy > it.y + it.height) continue;
    if (!generatedOpenAt(it, wx, wy, items)) return false;
    break;
  }
  const g = nav();
  const cell = g?.cell ?? 96;
  if (wanderGuideNear(wx, wy, cell * 0.48)) return true;
  if (!g) return false;
  const { c, r } = cellOf(g, wx, wy);
  return g.walk[at(g, c, r)] === 1;
}

function pathHitsGeneratedWall(pts: NavPt[]): boolean {
  if (pts.length < 2) return false;
  const items = useItemStore.getState().items;
  const painted = Object.values(items).filter(
    (i): i is MapItem => i.type === 'map' && isGeneratedDungeonMap(i),
  );
  if (painted.length === 0) return false;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if (painted.some((map) => generatedSegHitsSolidWall(map, a.x, a.y, b.x, b.y, items))) return true;
  }
  return false;
}

export function wanderNavSnap(wx: number, wy: number): NavPt {
  const guided = wanderGuideSnap(wx, wy);
  if ((guided.x !== wx || guided.y !== wy) && !pathHitsGeneratedWall([{ x: wx, y: wy }, guided])) {
    return guided;
  }
  const g = nav();
  if (!g) return { x: wx, y: wy };
  const start = cellOf(g, wx, wy);
  if (g.walk[at(g, start.c, start.r)]) return worldOf(g, start.c, start.r);
  for (let rad = 1; rad <= 16; rad++) {
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dc), Math.abs(dr)) !== rad) continue;
        const c = start.c + dc;
        const r = start.r + dr;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) continue;
        if (g.walk[at(g, c, r)]) return worldOf(g, c, r);
      }
    }
  }
  return { x: wx, y: wy };
}

export function wanderNavPath(fromX: number, fromY: number, toX: number, toY: number): NavPt[] | null {
  const g = nav();
  const startCell = g ? cellOf(g, fromX, fromY) : null;
  const goalCell = g ? cellOf(g, toX, toY) : null;
  const startPt = g && startCell && g.walk[at(g, startCell.c, startCell.r)]
    ? { x: fromX, y: fromY }
    : wanderNavSnap(fromX, fromY);
  const goalPt = g && goalCell && g.walk[at(g, goalCell.c, goalCell.r)]
    ? { x: toX, y: toY }
    : wanderNavSnap(toX, toY);
  const gridPath = g ? wanderNavGridPath(g, startPt, goalPt) : null;
  if (gridPath && gridPath.length > 1 && !pathHitsGeneratedWall([startPt, ...gridPath])) return gridPath;
  const guided = wanderGuidePath(fromX, fromY, toX, toY);
  if (guided && guided.length > 0 && !pathHitsGeneratedWall([startPt, ...guided, goalPt])) return guided;
  return null;
}

function wanderNavGridPath(
  g: WanderNav,
  startPt: NavPt,
  goalPt: NavPt,
): NavPt[] | null {
  const start = cellOf(g, startPt.x, startPt.y);
  const goal = cellOf(g, goalPt.x, goalPt.y);
  if (!g.walk[at(g, start.c, start.r)] || !g.walk[at(g, goal.c, goal.r)]) return null;
  if (start.c === goal.c && start.r === goal.r) return [goalPt];

  const parent = new Int32Array(g.cols * g.rows).fill(-1);
  const q = [start.c, start.r];
  parent[at(g, start.c, start.r)] = at(g, start.c, start.r);
  const nbr = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  let found = false;
  for (let qi = 0; qi < q.length && !found; ) {
    const c = q[qi++]!;
    const r = q[qi++]!;
    for (const [dc, dr] of nbr) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const ni = at(g, nc, nr);
      if (parent[ni] !== -1 || !g.walk[ni]) continue;
      const from = at(g, c, r);
      if (dc === 1 && (g.wallEdge[from] & 1)) continue;
      if (dc === -1 && (g.wallEdge[ni] & 1)) continue;
      if (dr === 1 && (g.wallEdge[from] & 2)) continue;
      if (dr === -1 && (g.wallEdge[ni] & 2)) continue;
      parent[ni] = at(g, c, r);
      if (nc === goal.c && nr === goal.r) {
        found = true;
        break;
      }
      q.push(nc, nr);
    }
  }
  if (!found) return null;
  const rev: NavPt[] = [];
  let i = at(g, goal.c, goal.r);
  const startI = at(g, start.c, start.r);
  while (i !== startI) {
    const r = Math.floor(i / g.cols);
    const c = i - r * g.cols;
    rev.push(worldOf(g, c, r));
    i = parent[i]!;
    if (i < 0) break;
  }
  rev.reverse();
  rev.push(goalPt);
  if (rev.length <= 2) return rev;
  const out = [rev[0]!];
  for (let n = 1; n < rev.length - 1; n++) {
    const a = out[out.length - 1]!;
    const b = rev[n]!;
    const c = rev[n + 1]!;
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > g.cell * 0.2) out.push(b);
  }
  out.push(rev[rev.length - 1]!);
  return out;
}

/** Drop a cached grid when maps change (tests / HMR). */
export function invalidateWanderNav(): void {
  cache = null;
  invalidateWanderGuide();
  invalidateGeneratedWander();
}

invalidateWanderNav();
