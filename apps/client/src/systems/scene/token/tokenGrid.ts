import { getActiveMap } from '../store/itemStore';
import { activeGridInfo } from '../snap';
import type { TokenItem } from '../types';

export function worldToGridColRow(
  centerX: number,
  centerY: number,
  sizeCells = 1,
): { gridCol: number; gridRow: number } {
  const g = activeGridInfo();
  const ox = g.originX + g.offsetX;
  const oy = g.originY + g.offsetY;
  // gridCol/gridRow index the token's top-left cell, so its footprint aligns to
  // grid lines and a 1-cell token sits centered inside a single square (instead
  // of landing on the intersection of four squares).
  return {
    gridCol: Math.round((centerX - ox) / g.gridSize - sizeCells / 2),
    gridRow: Math.round((centerY - oy) / g.gridSize - sizeCells / 2),
  };
}

/** Top-left world position of the cell at the given column/row. */
export function gridCellOrigin(gridCol: number, gridRow: number): { x: number; y: number } {
  const g = activeGridInfo();
  const ox = g.originX + g.offsetX;
  const oy = g.originY + g.offsetY;
  return {
    x: ox + gridCol * g.gridSize,
    y: oy + gridRow * g.gridSize,
  };
}

/** Top-left world position for a token whose footprint starts at the given cell. */
export function tokenBoundsFromGrid(
  token: Pick<TokenItem, 'sizeCells'>,
  gridCol: number,
  gridRow: number,
): { x: number; y: number; width: number; height: number; gridCol: number; gridRow: number } {
  const g = activeGridInfo();
  const size = token.sizeCells * g.gridSize;
  const origin = gridCellOrigin(gridCol, gridRow);
  return {
    x: origin.x,
    y: origin.y,
    width: size,
    height: size,
    gridCol,
    gridRow,
  };
}

export function syncTokenGridFields(token: TokenItem): Pick<TokenItem, 'gridCol' | 'gridRow'> {
  const map = getActiveMap();
  if (!map) return {};
  const cx = token.x + token.width / 2;
  const cy = token.y + token.height / 2;
  return worldToGridColRow(cx, cy, token.sizeCells || 1);
}
