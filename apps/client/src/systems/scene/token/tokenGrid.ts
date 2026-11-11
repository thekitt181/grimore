import { getActiveMap } from '../store/itemStore';
import { activeGridInfo, gridInfoForMap } from '../snap';
import type { MapItem, TokenItem } from '../types';

export function worldToGridColRow(
  centerX: number,
  centerY: number,
  sizeCells = 1,
  map?: MapItem | null,
): { gridCol: number; gridRow: number } {
  const g = map ? gridInfoForMap(map) : activeGridInfo();
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
export function gridCellOrigin(
  gridCol: number,
  gridRow: number,
  map?: MapItem | null,
): { x: number; y: number } {
  const g = map ? gridInfoForMap(map) : activeGridInfo();
  const ox = g.originX + g.offsetX;
  const oy = g.originY + g.offsetY;
  return {
    x: ox + gridCol * g.gridSize,
    y: oy + gridRow * g.gridSize,
  };
}

/** Snap a token's top-left so its footprint sits on grid cells. */
export function snapTokenPosition(
  token: Pick<TokenItem, 'width' | 'height' | 'sizeCells'>,
  x: number,
  y: number,
  map?: MapItem | null,
): { x: number; y: number; gridCol: number; gridRow: number } {
  const sizeCells = token.sizeCells || 1;
  const { gridCol, gridRow } = worldToGridColRow(
    x + token.width / 2,
    y + token.height / 2,
    sizeCells,
    map,
  );
  const origin = gridCellOrigin(gridCol, gridRow, map);
  return { x: origin.x, y: origin.y, gridCol, gridRow };
}

/** Top-left world position for a token whose footprint starts at the given cell. */
export function tokenBoundsFromGrid(
  token: Pick<TokenItem, 'sizeCells'>,
  gridCol: number,
  gridRow: number,
  map?: MapItem | null,
): { x: number; y: number; width: number; height: number; gridCol: number; gridRow: number } {
  const g = map ? gridInfoForMap(map) : activeGridInfo();
  const size = token.sizeCells * g.gridSize;
  const origin = gridCellOrigin(gridCol, gridRow, map);
  return {
    x: origin.x,
    y: origin.y,
    width: size,
    height: size,
    gridCol,
    gridRow,
  };
}

/** Circle path and gold ring for a token of this pixel size. The ring stays a slim fraction of the disc so a 5ft token is not a thick band. */
export function tokenDisc(size: number): { radius: number; ring: number } {
  const outer = Math.max(2, size / 2);
  const ring = Math.max(0.5, Math.min(1.75, outer * 0.055));
  const radius = Math.max(ring + 1, outer - 0.5);
  return { radius, ring };
}

/** Keep tokens readable on a zoomed-out map (screen pixels, not world size). */
export const TOKEN_MIN_SCREEN_PX = 20;
export const TOKEN_MAX_ZOOM_BOOST = 8;

export function tokenZoomBoost(footprintPx: number, viewScale: number): number {
  const screen = Math.max(4, footprintPx) * Math.max(viewScale, 1e-4);
  if (screen >= TOKEN_MIN_SCREEN_PX) return 1;
  return Math.min(TOKEN_MAX_ZOOM_BOOST, TOKEN_MIN_SCREEN_PX / screen);
}

export function syncTokenGridFields(token: TokenItem): Pick<TokenItem, 'gridCol' | 'gridRow'> {
  const map = getActiveMap();
  if (!map) return {};
  const cx = token.x + token.width / 2;
  const cy = token.y + token.height / 2;
  return worldToGridColRow(cx, cy, token.sizeCells || 1);
}
