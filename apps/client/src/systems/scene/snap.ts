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

/**
 * Snap a dimension to the grid.
 * `minCells` is the smallest footprint (tokens use 0.25 so they can shrink below one square).
 */
export function snapSize(value: number, minCells = 1): number {
  const g = activeGridInfo();
  const cells = Math.max(0.25, minCells);
  const quantum = Math.max(1, g.gridSize * cells);
  return Math.max(quantum, Math.round(value / quantum) * quantum);
}

/** Snap a rotation (degrees) to 15-degree steps. */
export function snapAngle(deg: number): number {
  return Math.round(deg / 15) * 15;
}
