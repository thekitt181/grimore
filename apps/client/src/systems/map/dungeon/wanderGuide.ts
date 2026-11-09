/**
 * Invisible centerline through generated Kenney/KayKit dungeons:
 * room +, hall spines, opening stubs. Wanderers follow this so a door
 * around a corner is center → opening, never a diagonal into the wall.
 */
import {
  isModularGate,
  isModularWall,
  MODULAR_ROOM_WALL_CELLS,
  pieceForUrl,
} from '@/systems/map/library/modularKits';
import { doorWallsSignature } from '@/systems/map/props/doorCollision';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { Item, MapItem } from '@/systems/scene/types';
import {
  appendGeneratedGuide,
  generatedCellSize,
  generatedSegHitsSolidWall,
  isGeneratedDungeonMap,
} from './generatedWander';

export type GuidePt = { x: number; y: number };

const SIDES = ['N', 'E', 'S', 'W'] as const;
type Side = (typeof SIDES)[number];

type Guide = {
  sig: string;
  cell: number;
  nodes: GuidePt[];
  adj: number[][];
  segs: Array<{ a: number; b: number }>;
};

let cache: Guide | null = null;

function mapsSig(items: Record<string, Item>): string {
  const bits: string[] = [];
  for (const it of Object.values(items)) {
    if (it.type !== 'map') continue;
    bits.push(
      `${it.id}:${it.x}:${it.y}:${it.width}:${it.height}:${it.rotation ?? 0}:${it.modelUrl ?? ''}:${it.walls?.length ?? 0}:${it.dungeon ? doorWallsSignature(it, items) : ''}`,
    );
  }
  bits.sort();
  return bits.join('|');
}

function worldOpenings(map: MapItem): Side[] {
  const piece = pieceForUrl(map.modelUrl);
  if (!piece?.openings?.length) return [];
  const steps = ((Math.round((map.rotation ?? 0) / 90) % 4) + 4) % 4;
  return piece.openings.map((s) => SIDES[(SIDES.indexOf(s as Side) - steps + 4) % 4]!);
}

function floorCenter(map: MapItem): GuidePt {
  return { x: map.x + map.width / 2, y: map.y + map.height / 2 };
}

function innerInset(map: MapItem, cell: number): number {
  return pieceForUrl(map.modelUrl)?.kind === 'hall' ? cell * 1.25 : cell * MODULAR_ROOM_WALL_CELLS;
}

function armPoints(map: MapItem, side: Side, cell: number): { inner: GuidePt; open: GuidePt; through: GuidePt } {
  const c = floorCenter(map);
  const lip = cell * 0.85;
  const inner = innerInset(map, cell);
  const out = cell * 1.6;
  switch (side) {
    case 'E':
      return {
        inner: { x: map.x + map.width - inner, y: c.y },
        open: { x: map.x + map.width - lip, y: c.y },
        through: { x: map.x + map.width + out, y: c.y },
      };
    case 'W':
      return {
        inner: { x: map.x + inner, y: c.y },
        open: { x: map.x + lip, y: c.y },
        through: { x: map.x - out, y: c.y },
      };
    case 'S':
      return {
        inner: { x: c.x, y: map.y + map.height - inner },
        open: { x: c.x, y: map.y + map.height - lip },
        through: { x: c.x, y: map.y + map.height + out },
      };
    default:
      return {
        inner: { x: c.x, y: map.y + inner },
        open: { x: c.x, y: map.y + lip },
        through: { x: c.x, y: map.y - out },
      };
  }
}

function projectSeg(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { x: number; y: number; t: number; d2: number } {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  const t = len2 < 1 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / len2));
  const x = ax + abx * t;
  const y = ay + aby * t;
  const dx = px - x;
  const dy = py - y;
  return { x, y, t, d2: dx * dx + dy * dy };
}

function standFloors(items: Record<string, Item>): MapItem[] {
  return Object.values(items).filter((i): i is MapItem => {
    if (i.type !== 'map' || !i.modelUrl) return false;
    const k = pieceForUrl(i.modelUrl)?.kind;
    return k === 'room' || k === 'hall' || k === 'tile' || k === 'stairs' || k === 'gate';
  });
}

function floorNear(floors: MapItem[], x: number, y: number, pad: number, skipId?: string): boolean {
  for (const f of floors) {
    if (f.id === skipId) continue;
    if (x >= f.x - pad && x <= f.x + f.width + pad && y >= f.y - pad && y <= f.y + f.height + pad) {
      return true;
    }
  }
  return false;
}

function generatedMaps(items: Record<string, Item>): MapItem[] {
  return Object.values(items).filter((i): i is MapItem => i.type === 'map' && isGeneratedDungeonMap(i));
}

function buildGuide(items: Record<string, Item>): Guide | null {
  const floors = standFloors(items);
  const painted = generatedMaps(items);
  if (floors.length === 0 && painted.length === 0) return null;
  const cell = Math.max(
    8,
    floors[0]?.gridSize || (painted[0] ? generatedCellSize(painted[0]).cellX : 0) || 96,
  );
  const nodes: GuidePt[] = [];
  const adj: number[][] = [];
  const segs: Array<{ a: number; b: number }> = [];

  const addNode = (x: number, y: number): number => {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!;
      if ((n.x - x) ** 2 + (n.y - y) ** 2 <= (cell * 0.35) ** 2) return i;
    }
    nodes.push({ x, y });
    adj.push([]);
    return nodes.length - 1;
  };
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    if (!adj[a]!.includes(b)) {
      adj[a]!.push(b);
      adj[b]!.push(a);
      segs.push({ a, b });
    }
  };

  for (const floor of floors) {
    const kind = pieceForUrl(floor.modelUrl)?.kind;
    if (kind === 'gate') {
      const c = floorCenter(floor);
      addNode(c.x, c.y);
      continue;
    }
    if (kind !== 'room' && kind !== 'hall' && kind !== 'stairs' && kind !== 'tile') continue;
    const c = floorCenter(floor);
    const cid = addNode(c.x, c.y);
    const openings = worldOpenings(floor);
    const sides = openings.length ? openings : kind === 'tile' ? [] : SIDES;
    for (const side of sides) {
      const p = armPoints(floor, side, cell);
      const iid = addNode(p.inner.x, p.inner.y);
      const oid = addNode(p.open.x, p.open.y);
      addEdge(cid, iid);
      addEdge(iid, oid);
      if (floorNear(floors, p.through.x, p.through.y, cell * 0.8, floor.id)) {
        addEdge(oid, addNode(p.through.x, p.through.y));
      }
    }
  }

  for (const map of painted) appendGeneratedGuide(map, addNode, addEdge);

  for (const it of Object.values(items)) {
    if (it.type !== 'map' || !isModularWall(it) || isModularGate(it)) continue;
    const key = pieceForUrl(it.modelUrl)?.key ?? '';
    if (!/doorway|gated|crossing/i.test(key) && !isModularGate(it)) continue;
    const c = floorCenter(it);
    addNode(c.x, c.y);
  }

  const joinR = cell * 2.2;
  const joinR2 = joinR * joinR;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i]!.x - nodes[j]!.x;
      const dy = nodes[i]!.y - nodes[j]!.y;
      if (dx * dx + dy * dy > joinR2) continue;
      const already = adj[i]!.includes(j);
      if (already) continue;
      const axis = Math.abs(dx) < cell * 0.45 || Math.abs(dy) < cell * 0.45;
      if (!axis) continue;
      let blocked = false;
      for (const map of painted) {
        if (generatedSegHitsSolidWall(map, nodes[i]!.x, nodes[i]!.y, nodes[j]!.x, nodes[j]!.y, items)) {
          blocked = true;
          break;
        }
      }
      if (!blocked) addEdge(i, j);
    }
  }

  if (nodes.length === 0) return null;
  return { sig: mapsSig(items), cell, nodes, adj, segs };
}

function guide(): Guide | null {
  const items = useItemStore.getState().items;
  const sig = mapsSig(items);
  if (!cache || cache.sig !== sig) cache = buildGuide(items);
  return cache;
}

export function invalidateWanderGuide(): void {
  cache = null;
}

export function wanderGuideSnap(wx: number, wy: number): GuidePt {
  const g = guide();
  if (!g || g.segs.length === 0) return { x: wx, y: wy };
  let best: GuidePt = g.nodes[0]!;
  let bestD = Infinity;
  for (const s of g.segs) {
    const a = g.nodes[s.a]!;
    const b = g.nodes[s.b]!;
    const p = projectSeg(wx, wy, a.x, a.y, b.x, b.y);
    if (p.d2 < bestD) {
      bestD = p.d2;
      best = { x: p.x, y: p.y };
    }
  }
  return best;
}

/** Snap onto the guide without walking backward away from `ax, ay`. */
export function wanderGuideSnapToward(wx: number, wy: number, ax: number, ay: number): GuidePt {
  const g = guide();
  if (!g || g.segs.length === 0) return { x: wx, y: wy };
  const ux = ax - wx;
  const uy = ay - wy;
  const ulen = Math.hypot(ux, uy) || 1;
  let best: GuidePt | null = null;
  let bestScore = -Infinity;
  for (const s of g.segs) {
    const a = g.nodes[s.a]!;
    const b = g.nodes[s.b]!;
    const p = projectSeg(wx, wy, a.x, a.y, b.x, b.y);
    const prog = ((p.x - wx) * ux + (p.y - wy) * uy) / ulen;
    if (prog < -4) continue;
    const score = prog * 3 - Math.sqrt(p.d2);
    if (score > bestScore) {
      bestScore = score;
      best = { x: p.x, y: p.y };
    }
  }
  return best ?? { x: wx, y: wy };
}

export function wanderGuideNear(wx: number, wy: number, radius: number): boolean {
  const g = guide();
  if (!g) return false;
  const r2 = radius * radius;
  for (const s of g.segs) {
    const a = g.nodes[s.a]!;
    const b = g.nodes[s.b]!;
    if (projectSeg(wx, wy, a.x, a.y, b.x, b.y).d2 <= r2) return true;
  }
  return false;
}

export function wanderGuidePath(fromX: number, fromY: number, toX: number, toY: number): GuidePt[] | null {
  const g = guide();
  if (!g || g.nodes.length === 0) return null;
  const start = wanderGuideSnap(fromX, fromY);
  const goal = wanderGuideSnap(toX, toY);

  let startN = 0;
  let goalN = 0;
  let startD = Infinity;
  let goalD = Infinity;
  for (let i = 0; i < g.nodes.length; i++) {
    const n = g.nodes[i]!;
    const ds = (n.x - start.x) ** 2 + (n.y - start.y) ** 2;
    const dg = (n.x - goal.x) ** 2 + (n.y - goal.y) ** 2;
    if (ds < startD) {
      startD = ds;
      startN = i;
    }
    if (dg < goalD) {
      goalD = dg;
      goalN = i;
    }
  }

  if (startN === goalN) return [goal];

  const parent = new Int32Array(g.nodes.length).fill(-1);
  const q = [startN];
  parent[startN] = startN;
  for (let qi = 0; qi < q.length; qi++) {
    const i = q[qi]!;
    if (i === goalN) break;
    for (const n of g.adj[i]!) {
      if (parent[n] !== -1) continue;
      const a = g.nodes[i]!;
      const b = g.nodes[n]!;
      let blocked = false;
      for (const map of generatedMaps(useItemStore.getState().items)) {
        if (generatedSegHitsSolidWall(map, a.x, a.y, b.x, b.y)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      parent[n] = i;
      q.push(n);
    }
  }
  if (parent[goalN] === -1) return null;

  const rev: GuidePt[] = [];
  let i = goalN;
  while (i !== startN) {
    rev.push(g.nodes[i]!);
    i = parent[i]!;
    if (i < 0) break;
  }
  rev.reverse();
  const out: GuidePt[] = [start];
  for (const p of rev) {
    const last = out[out.length - 1]!;
    if ((p.x - last.x) ** 2 + (p.y - last.y) ** 2 > 4) out.push(p);
  }
  const last = out[out.length - 1]!;
  if ((goal.x - last.x) ** 2 + (goal.y - last.y) ** 2 > 4) out.push(goal);
  return out;
}

invalidateWanderGuide();
