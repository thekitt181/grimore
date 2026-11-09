/**
 * Occupancy map of the modular dungeon: inner floors, corridor centers, gate middles.
 * Wanderers BFS this grid so they do not walk into Kenney wall shells.
 */
import {
  isModularGate,
  isModularWall,
  MODULAR_ROOM_WALL_CELLS,
  pieceForUrl,
} from '@/systems/map/library/modularKits';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Item, MapItem } from '@/systems/scene/types';

export type NavPt = { x: number; y: number };

type WanderNav = {
  sig: string;
  cell: number;
  originX: number;
  originY: number;
  cols: number;
  rows: number;
  walk: Uint8Array;
};

let cache: WanderNav | null = null;

function mapsSig(items: Record<string, Item>): string {
  const bits: string[] = [];
  for (const it of Object.values(items)) {
    if (it.type !== 'map') continue;
    bits.push(
      `${it.id}:${it.x}:${it.y}:${it.width}:${it.height}:${it.rotation ?? 0}:${it.modelUrl ?? ''}:${it.modularOpen ? 1 : 0}`,
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
    const inset = cell * Math.min(2.7, MODULAR_ROOM_WALL_CELLS);
    return Math.abs(lx) <= map.width / 2 - inset && Math.abs(ly) <= map.height / 2 - inset;
  }
  if (kind === 'hall') {
    const inset = cell * 0.95;
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
  const maps = Object.values(items).filter((i): i is MapItem => i.type === 'map' && Boolean(i.modelUrl));
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
  };

  const floors = maps.filter((m) => {
    const k = pieceForUrl(m.modelUrl)?.kind;
    return k === 'room' || k === 'hall' || k === 'tile' || k === 'stairs' || k === 'gate';
  });
  const walls = maps.filter((m) => isModularWall(m) && !isModularGate(m));

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

  for (const gate of maps.filter((m) => isModularGate(m))) {
    const cx = gate.x + gate.width / 2;
    const cy = gate.y + gate.height / 2;
    mark(nav, cx, cy);
    const thinX = gate.width <= gate.height;
    mark(nav, cx + (thinX ? 0 : cell), cy + (thinX ? cell : 0));
    mark(nav, cx - (thinX ? 0 : cell), cy - (thinX ? cell : 0));
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
  const g = nav();
  if (!g) return false;
  const { c, r } = cellOf(g, wx, wy);
  return g.walk[at(g, c, r)] === 1;
}

export function wanderNavSnap(wx: number, wy: number): NavPt {
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
  if (!g) return null;
  const start = cellOf(g, wanderNavSnap(fromX, fromY).x, wanderNavSnap(fromX, fromY).y);
  const goalPt = wanderNavSnap(toX, toY);
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
}
