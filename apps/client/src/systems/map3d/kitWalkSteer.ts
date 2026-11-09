/**
 * Steer feet off Kenney/KayKit solids: inner room shell + thin wall slabs.
 * Clip velocity so we slide along a wall instead of walking into it.
 */
import {
  isModularGate,
  isModularWall,
  MODULAR_ROOM_WALL_CELLS,
  pieceForUrl,
} from '@/systems/map/library/modularKits';
import { listModularWalls, listStandFloors } from '@/systems/scene/hitTest';
import type { MapItem } from '@/systems/scene/types';

const SIDES = ['N', 'E', 'S', 'W'] as const;
type Side = (typeof SIDES)[number];

function localXY(map: MapItem, wx: number, wy: number): { lx: number; ly: number; c: number; s: number } {
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = ((map.rotation ?? 0) * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = wx - cx;
  const dy = wy - cy;
  return { lx: dx * c + dy * s, ly: -dx * s + dy * c, c, s };
}

function worldOpenings(map: MapItem): Side[] {
  const piece = pieceForUrl(map.modelUrl);
  if (!piece?.openings?.length) return [];
  const steps = ((Math.round((map.rotation ?? 0) / 90) % 4) + 4) % 4;
  return piece.openings.map((side) => SIDES[(SIDES.indexOf(side as Side) - steps + 4) % 4]!);
}

function openingCenter(map: MapItem, side: Side, cell: number): { x: number; y: number; thinX: boolean } {
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const inset = cell * 0.85;
  switch (side) {
    case 'W':
      return { x: map.x + inset, y: cy, thinX: true };
    case 'E':
      return { x: map.x + map.width - inset, y: cy, thinX: true };
    case 'N':
      return { x: cx, y: map.y + inset, thinX: false };
    default:
      return { x: cx, y: map.y + map.height - inset, thinX: false };
  }
}

/** Door/opening strip — walking here is allowed through the shell. */
export function inKitDoorLane(wx: number, wy: number, cell: number): boolean {
  const half = cell * 0.55;
  // Inner floor (3.5 from AABB) to alcove (~0.85 from AABB), not the room center.
  const along = cell * 3.05;
  for (const floor of listStandFloors(wx, wy, cell * 1.2)) {
    const kind = pieceForUrl(floor.modelUrl)?.kind;
    if (kind !== 'room' && kind !== 'hall') continue;
    const gs = Math.max(8, floor.gridSize);
    for (const side of worldOpenings(floor)) {
      const p = openingCenter(floor, side, gs);
      if (p.thinX) {
        if (Math.abs(wy - p.y) <= half && Math.abs(wx - p.x) <= along) return true;
      } else if (Math.abs(wx - p.x) <= half && Math.abs(wy - p.y) <= along) {
        return true;
      }
    }
  }
  for (const wall of listModularWalls(wx, wy, cell * 1.4)) {
    if (!isModularGate(wall) && !/doorway|gated|crossing/i.test(pieceForUrl(wall.modelUrl)?.key ?? '')) {
      continue;
    }
    const cx = wall.x + wall.width / 2;
    const cy = wall.y + wall.height / 2;
    const thinX = wall.width <= wall.height;
    const across = Math.min(wall.width, wall.height) * 0.3 + cell * 0.12;
    const long = Math.max(wall.width, wall.height) * 0.55 + cell * 0.7;
    if (thinX) {
      if (Math.abs(wx - cx) <= across && Math.abs(wy - cy) <= long) return true;
    } else if (Math.abs(wy - cy) <= across && Math.abs(wx - cx) <= long) {
      return true;
    }
  }
  return false;
}

function clipVel(vx: number, vy: number, nx: number, ny: number): { vx: number; vy: number } {
  const nLen = Math.hypot(nx, ny);
  if (nLen < 1e-6) return { vx, vy };
  const nnx = nx / nLen;
  const nny = ny / nLen;
  const into = vx * nnx + vy * nny;
  if (into >= 0) return { vx, vy };
  return { vx: vx - nnx * into, vy: vy - nny * into };
}

function shellInset(map: MapItem): number {
  const cell = Math.max(8, map.gridSize);
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (kind === 'hall') return cell * 1.25;
  return cell * MODULAR_ROOM_WALL_CELLS;
}

function applyRoomShell(
  map: MapItem,
  wx: number,
  wy: number,
  vx: number,
  vy: number,
  radius: number,
): { x: number; y: number; vx: number; vy: number } {
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (kind !== 'room' && kind !== 'hall') return { x: wx, y: wy, vx, vy };
  const cell = Math.max(8, map.gridSize);
  if (inKitDoorLane(wx, wy, cell)) return { x: wx, y: wy, vx, vy };
  const others = listStandFloors(wx, wy, cell * 0.4).filter((f) => f.id !== map.id);
  if (others.length > 0) return { x: wx, y: wy, vx, vy };

  const inset = shellInset(map);
  const innerW = map.width / 2 - inset - radius;
  const innerH = map.height / 2 - inset - radius;
  if (innerW < cell * 0.4 || innerH < cell * 0.4) return { x: wx, y: wy, vx, vy };

  const { lx, ly, c, s } = localXY(map, wx, wy);
  let nlx = lx;
  let nly = ly;
  let ovx = vx;
  let ovy = vy;
  const axX = c;
  const axY = s;
  const ayX = -s;
  const ayY = c;

  if (nlx > innerW) {
    const clipped = clipVel(ovx, ovy, -axX, -axY);
    ovx = clipped.vx;
    ovy = clipped.vy;
    nlx = innerW;
  } else if (nlx < -innerW) {
    const clipped = clipVel(ovx, ovy, axX, axY);
    ovx = clipped.vx;
    ovy = clipped.vy;
    nlx = -innerW;
  }
  if (nly > innerH) {
    const clipped = clipVel(ovx, ovy, -ayX, -ayY);
    ovx = clipped.vx;
    ovy = clipped.vy;
    nly = innerH;
  } else if (nly < -innerH) {
    const clipped = clipVel(ovx, ovy, ayX, ayY);
    ovx = clipped.vx;
    ovy = clipped.vy;
    nly = -innerH;
  }

  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  return {
    x: cx + nlx * c - nly * s,
    y: cy + nlx * s + nly * c,
    vx: ovx,
    vy: ovy,
  };
}

function applyThinWall(
  wall: MapItem,
  wx: number,
  wy: number,
  vx: number,
  vy: number,
  radius: number,
): { x: number; y: number; vx: number; vy: number } {
  if (!isModularWall(wall)) return { x: wx, y: wy, vx, vy };
  if (isModularGate(wall) && wall.modularOpen) return { x: wx, y: wy, vx, vy };
  if (/doorway|gated|crossing|window_open/i.test(pieceForUrl(wall.modelUrl)?.key ?? '')) {
    return { x: wx, y: wy, vx, vy };
  }
  const short = Math.min(wall.width, wall.height);
  const long = Math.max(wall.width, wall.height);
  if (long / Math.max(1, short) < 1.35) return { x: wx, y: wy, vx, vy };
  const cell = Math.max(8, wall.gridSize);
  if (inKitDoorLane(wx, wy, cell)) return { x: wx, y: wy, vx, vy };

  const half = Math.min(short * 0.22, cell * 0.22) + radius;
  const { lx, ly, c, s } = localXY(wall, wx, wy);
  const across = wall.width <= wall.height ? lx : ly;
  const along = wall.width <= wall.height ? ly : lx;
  if (Math.abs(along) > long / 2 + radius) return { x: wx, y: wy, vx, vy };

  const nx = wall.width <= wall.height ? c : -s;
  const ny = wall.width <= wall.height ? s : c;
  const sign = across >= 0 ? 1 : -1;
  const awayX = nx * sign;
  const awayY = ny * sign;
  let ovx = vx;
  let ovy = vy;
  const clipped = clipVel(ovx, ovy, awayX, awayY);
  ovx = clipped.vx;
  ovy = clipped.vy;

  if (Math.abs(across) >= half) return { x: wx, y: wy, vx: ovx, vy: ovy };
  const push = half - Math.abs(across);
  return { x: wx + awayX * push, y: wy + awayY * push, vx: ovx, vy: ovy };
}

/**
 * Push overlapping feet out of kit solids and remove the velocity component
 * that walks into a wall (slide along it).
 */
export function steerKitWalk(
  wx: number,
  wy: number,
  vx: number,
  vy: number,
  radius: number,
  opts?: { roomShell?: boolean },
): { x: number; y: number; vx: number; vy: number } {
  let x = wx;
  let y = wy;
  let ovx = vx;
  let ovy = vy;
  const cell = 96;
  const pad = Math.max(radius * 4, cell);
  const useShell = opts?.roomShell !== false;

  for (let i = 0; i < 3; i++) {
    const floors = listStandFloors(x, y, pad);
    if (useShell) {
      for (const floor of floors) {
        const next = applyRoomShell(floor, x, y, ovx, ovy, radius);
        x = next.x;
        y = next.y;
        ovx = next.vx;
        ovy = next.vy;
      }
    }
    for (const wall of listModularWalls(x, y, pad)) {
      const next = applyThinWall(wall, x, y, ovx, ovy, radius);
      x = next.x;
      y = next.y;
      ovx = next.vx;
      ovy = next.vy;
    }
  }
  return { x, y, vx: ovx, vy: ovy };
}
