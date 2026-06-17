import { useEffect, useRef } from 'react';
import { Graphics, Container } from 'pixi.js';
import type { GridType } from '../store/mapStore';

export interface GridOptions {
  gridType: GridType;
  gridSize: number;
  mapWidth: number;
  mapHeight: number;
  visible: boolean;
  gridColor: number;    // e.g. 0x2a2a3a
  gridOpacity: number;  // 0-1
  gridOffsetX?: number; // px shift
  gridOffsetY?: number;
}

export function useMapGrid(
  layerRef: React.RefObject<Container | null>,
  options: GridOptions
) {
  const graphicsRef = useRef<Graphics | null>(null);

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    if (!graphicsRef.current) {
      graphicsRef.current = new Graphics();
      graphicsRef.current.label = 'grid-gfx'; // labelled so resize hook can find it
      layer.addChild(graphicsRef.current);
    }

    redrawGrid(
      graphicsRef.current,
      options.gridType,
      options.mapWidth,
      options.mapHeight,
      options.gridSize,
      options.gridColor,
      options.gridOpacity,
      options.visible,
      options.gridOffsetX ?? 0,
      options.gridOffsetY ?? 0,
    );
  }, [
    options.gridType,
    options.gridSize,
    options.mapWidth,
    options.mapHeight,
    options.visible,
    options.gridColor,
    options.gridOpacity,
    options.gridOffsetX,
    options.gridOffsetY,
  ]);
}

/** Exported so the resize/calibrate hooks can call it directly. */
export function redrawGrid(
  g: Graphics,
  gridType: GridType,
  mapWidth: number,
  mapHeight: number,
  gridSize: number,
  gridColor: number,
  gridOpacity: number,
  visible = true,
  offsetX = 0,
  offsetY = 0,
) {
  g.clear();
  g.visible = visible;
  if (!visible || gridSize <= 0) return;

  // Tile offset into [0, gridSize) range so lines start within the first cell
  const ox = ((offsetX % gridSize) + gridSize) % gridSize;
  const oy = ((offsetY % gridSize) + gridSize) % gridSize;

  const cols = Math.ceil((mapWidth  + gridSize) / gridSize) + 1;
  const rows = Math.ceil((mapHeight + gridSize) / gridSize) + 1;

  // pixelLine keeps grid lines a crisp 1 device pixel at any zoom, avoiding the
  // shimmer/moiré that scaled hairlines produce when zoomed out.
  g.setStrokeStyle({ width: 1, color: gridColor, alpha: gridOpacity, pixelLine: true });

  if (gridType === 'square') {
    drawSquareGrid(g, cols, rows, gridSize, ox, oy);
  } else {
    drawHexGrid(g, cols, rows, gridSize, ox, oy);
  }

  g.stroke();
}

function drawSquareGrid(
  g: Graphics, cols: number, rows: number, size: number, ox: number, oy: number
) {
  for (let x = 0; x <= cols; x++) {
    const px = x * size - (size - ox);
    g.moveTo(px, -size);
    g.lineTo(px, rows * size);
  }
  for (let y = 0; y <= rows; y++) {
    const py = y * size - (size - oy);
    g.moveTo(-size, py);
    g.lineTo(cols * size, py);
  }
}

function drawHexGrid(
  g: Graphics, cols: number, rows: number, size: number, ox: number, oy: number
) {
  const w = Math.sqrt(3) * size;
  const h = 2 * size;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const rowOffset = row % 2 === 0 ? 0 : w / 2;
      const cx = col * w + rowOffset + ox;
      const cy = row * (h * 0.75) + oy;
      drawHex(g, cx, cy, size);
    }
  }
}

function drawHex(g: Graphics, cx: number, cy: number, size: number) {
  for (let i = 0; i < 6; i++) {
    const rad = (Math.PI / 180) * (60 * i - 30);
    const x = cx + size * Math.cos(rad);
    const y = cy + size * Math.sin(rad);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}
