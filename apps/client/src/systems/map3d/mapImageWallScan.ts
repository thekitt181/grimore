import { loadImageUrl } from '@/lib/textureLoader';
import type { MapItem } from '@/systems/scene/types';

export type WallCellGrid = {
  cols: number;
  rows: number;
  /** Row-major: index = y * cols + x */
  cells: Uint8Array;
};

export type MapWallScanOptions = {
  /** Average cell luminance below this → wall (0–255). */
  threshold?: number;
  /** Fraction of dark pixels in a cell to classify as wall (0–1). */
  darkRatio?: number;
  /** Pixel luminance counted as "dark". */
  darkPixelLum?: number;
};

export type MapWallScanResult = WallCellGrid & {
  wallCellCount: number;
};

const DEFAULTS: Required<MapWallScanOptions> = {
  threshold: 98,
  darkRatio: 0.38,
  darkPixelLum: 72,
};

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function readImagePixels(
  img: HTMLImageElement,
  width: number,
  height: number,
): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  try {
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}

function classifyCells(
  data: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  cols: number,
  rows: number,
  gridSize: number,
  offsetX: number,
  offsetY: number,
  opts: Required<MapWallScanOptions>,
): Uint8Array {
  const cells = new Uint8Array(cols * rows);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.min(mapW - 1, Math.max(0, offsetX + cx * gridSize));
      const y0 = Math.min(mapH - 1, Math.max(0, offsetY + cy * gridSize));
      const x1 = Math.min(mapW, x0 + gridSize);
      const y1 = Math.min(mapH, y0 + gridSize);

      let sumLum = 0;
      let darkCount = 0;
      let count = 0;

      for (let py = y0; py < y1; py++) {
        for (let px = x0; px < x1; px++) {
          const i = (py * mapW + px) * 4;
          const r = data[i]!;
          const g = data[i + 1]!;
          const b = data[i + 2]!;
          const a = data[i + 3]!;
          if (a < 16) continue;
          const lum = luminance(r, g, b);
          sumLum += lum;
          if (lum < opts.darkPixelLum) darkCount++;
          count++;
        }
      }

      if (count === 0) continue;
      const avgLum = sumLum / count;
      const ratio = darkCount / count;
      if (avgLum < opts.threshold || ratio >= opts.darkRatio) {
        cells[cy * cols + cx] = 1;
      }
    }
  }

  return cells;
}

/** Remove speckle noise — cell survives only if it has a wall neighbour. */
function pruneIsolated(cells: Uint8Array, cols: number, rows: number): void {
  const copy = Uint8Array.from(cells);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!copy[idx]) continue;
      let neighbours = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (copy[ny * cols + nx]) neighbours++;
        }
      }
      if (neighbours < 2) cells[idx] = 0;
    }
  }
}

function dilate(cells: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = Uint8Array.from(cells);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!cells[y * cols + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          out[ny * cols + nx] = 1;
        }
      }
    }
  }
  return out;
}

function erode(cells: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = Uint8Array.from(cells);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!cells[y * cols + x]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !cells[ny * cols + nx]) {
            out[y * cols + x] = 0;
            break;
          }
        }
        if (!out[y * cols + x]) break;
      }
    }
  }
  return out;
}

function morphClose(cells: Uint8Array, cols: number, rows: number): Uint8Array {
  return erode(dilate(cells, cols, rows), cols, rows);
}

function boundaryWallCells(cells: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cells.length);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!cells[idx]) continue;
      const left = x > 0 && cells[idx - 1];
      const right = x < cols - 1 && cells[idx + 1];
      const up = y > 0 && cells[idx - cols];
      const down = y < rows - 1 && cells[idx + cols];
      if (!left || !right || !up || !down) out[idx] = 1;
    }
  }
  return out;
}

/**
 * Scan a battle map image for dark wall regions and return a grid of wall cells
 * aligned to the map grid (for 3D voxel extrusion).
 */
export async function scanMapImageForWalls(
  map: Pick<MapItem, 'backgroundUrl' | 'width' | 'height' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>,
  options?: MapWallScanOptions,
): Promise<MapWallScanResult | null> {
  if (!map.backgroundUrl) return null;

  const opts = { ...DEFAULTS, ...options };
  const gridSize = Math.max(4, map.gridSize);
  const cols = Math.ceil(map.width / gridSize);
  const rows = Math.ceil(map.height / gridSize);

  const img = await loadImageUrl(map.backgroundUrl);
  const maxDim = 2400;
  const scale = Math.min(1, maxDim / Math.max(map.width, map.height));
  const sampleW = Math.max(32, Math.round(map.width * scale));
  const sampleH = Math.max(32, Math.round(map.height * scale));

  const data = readImagePixels(img, sampleW, sampleH);
  if (!data) return null;

  const scaledGrid = Math.max(4, Math.round(gridSize * scale));
  const scaledOffsetX = Math.round(map.gridOffsetX * scale);
  const scaledOffsetY = Math.round(map.gridOffsetY * scale);

  let cells = classifyCells(
    data,
    sampleW,
    sampleH,
    cols,
    rows,
    scaledGrid,
    scaledOffsetX,
    scaledOffsetY,
    opts,
  );
  cells = morphClose(cells, cols, rows);
  pruneIsolated(cells, cols, rows);
  cells = boundaryWallCells(cells, cols, rows);

  let wallCellCount = 0;
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) wallCellCount++;
  }

  return { cols, rows, cells, wallCellCount };
}

/** Cache key for scan results. */
export function wallScanCacheKey(
  map: Pick<MapItem, 'id' | 'backgroundUrl' | 'width' | 'height' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>,
  threshold: number,
): string {
  return `${map.id}|${map.backgroundUrl ?? ''}|${map.width}x${map.height}|${map.gridSize}|${map.gridOffsetX},${map.gridOffsetY}|t${threshold}`;
}
