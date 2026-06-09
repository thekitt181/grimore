import { getActiveMap } from './store/itemStore';

export interface GridInfo {
  gridSize: number;
  offsetX: number;
  offsetY: number;
  originX: number; // map world x
  originY: number; // map world y
}

/** Returns the active map's grid info, or a sane default if no map exists. */
export function activeGridInfo(): GridInfo {
  const map = getActiveMap();
  if (!map) return { gridSize: 96, offsetX: 0, offsetY: 0, originX: 0, originY: 0 };
  return {
    gridSize: map.gridSize,
    offsetX: map.gridOffsetX,
    offsetY: map.gridOffsetY,
    originX: map.x,
    originY: map.y,
  };
}

/** Snap a world point to the nearest grid intersection of the active map. */
export function snapPoint(wx: number, wy: number): { x: number; y: number } {
  const g = activeGridInfo();
  const ox = g.originX + g.offsetX;
  const oy = g.originY + g.offsetY;
  return {
    x: Math.round((wx - ox) / g.gridSize) * g.gridSize + ox,
    y: Math.round((wy - oy) / g.gridSize) * g.gridSize + oy,
  };
}

/** Snap a single dimension (width/height) to a positive multiple of the grid. */
export function snapSize(value: number): number {
  const g = activeGridInfo();
  return Math.max(g.gridSize, Math.round(value / g.gridSize) * g.gridSize);
}

/** Snap a rotation (degrees) to 15-degree steps. */
export function snapAngle(deg: number): number {
  return Math.round(deg / 15) * 15;
}
