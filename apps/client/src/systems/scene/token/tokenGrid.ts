import { getActiveMap } from '../store/itemStore';
import { activeGridInfo } from '../snap';
import type { TokenItem } from '../types';

export function worldToGridColRow(wx: number, wy: number): { gridCol: number; gridRow: number } {
  const g = activeGridInfo();
  const ox = g.originX + g.offsetX;
  const oy = g.originY + g.offsetY;
  return {
    gridCol: Math.round((wx - ox) / g.gridSize),
    gridRow: Math.round((wy - oy) / g.gridSize),
  };
}

export function gridCellCenter(gridCol: number, gridRow: number): { x: number; y: number } {
  const g = activeGridInfo();
  const ox = g.originX + g.offsetX;
  const oy = g.originY + g.offsetY;
  return {
    x: ox + gridCol * g.gridSize,
    y: oy + gridRow * g.gridSize,
  };
}

/** Top-left world position for a token centered on a grid cell. */
export function tokenBoundsFromGrid(
  token: Pick<TokenItem, 'sizeCells'>,
  gridCol: number,
  gridRow: number,
): { x: number; y: number; width: number; height: number; gridCol: number; gridRow: number } {
  const g = activeGridInfo();
  const size = token.sizeCells * g.gridSize;
  const center = gridCellCenter(gridCol, gridRow);
  return {
    x: center.x - size / 2,
    y: center.y - size / 2,
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
  return worldToGridColRow(cx, cy);
}
