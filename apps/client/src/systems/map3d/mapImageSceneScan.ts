import { loadImageUrl } from '@/lib/textureLoader';
import type { MapItem } from '@/systems/scene/types';

export type PropKind =
  | 'chair'
  | 'table'
  | 'bench'
  | 'bed'
  | 'shelf'
  | 'stairs'
  | 'fountain'
  | 'water'
  | 'pillar'
  | 'torch'
  | 'prop';

export type ScannedProp = {
  id: string;
  kind: PropKind;
  cx: number;
  cz: number;
  widthCells: number;
  depthCells: number;
  rotation: number;
};

export type ScannedWater = {
  id: string;
  cx: number;
  cz: number;
  radiusCells: number;
  kind: 'pool' | 'fountain';
};

export type ScannedStairs = {
  id: string;
  cx: number;
  cz: number;
  widthCells: number;
  depthCells: number;
  rotation: number;
  steps: number;
};

export type ScannedPit = {
  id: string;
  cx: number;
  cz: number;
  radiusCells: number;
};

export type ScannedWallSegment = {
  id: string;
  cx: number;
  cz: number;
  length: number;
  thickness: number;
  rotation: number;
};

export type MapSceneScanResult = {
  cols: number;
  rows: number;
  wallCells: Uint8Array;
  wallSegments: ScannedWallSegment[];
  wallCellCount: number;
  props: ScannedProp[];
  waters: ScannedWater[];
  stairs: ScannedStairs[];
  pits: ScannedPit[];
  featureCount: number;
};

export type MapSceneScanOptions = {
  threshold?: number;
  darkRatio?: number;
  darkPixelLum?: number;
};

const DEFAULTS: Required<MapSceneScanOptions> = {
  threshold: 78,
  darkRatio: 0.42,
  darkPixelLum: 65,
};

const CELL_FLOOR = 0;
const CELL_WALL = 1;
const CELL_WATER = 2;
const CELL_STAIRS = 3;
const CELL_DETAIL = 4;

type CellStats = {
  r: number;
  g: number;
  b: number;
  lum: number;
  variance: number;
  darkRatio: number;
  stripe: number;
};

function luminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function readImagePixels(img: HTMLImageElement, width: number, height: number): Uint8ClampedArray | null {
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

function sampleCellStats(
  data: Uint8ClampedArray,
  mapW: number,
  mapH: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  darkPixelLum: number,
): CellStats | null {
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sumLum = 0;
  let sumLumSq = 0;
  let darkCount = 0;
  let count = 0;
  const rowLums: number[] = [];

  for (let py = y0; py < y1; py++) {
    let rowSum = 0;
    let rowN = 0;
    for (let px = x0; px < x1; px++) {
      const i = (py * mapW + px) * 4;
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;
      const a = data[i + 3]!;
      if (a < 16) continue;
      const lum = luminance(r, g, b);
      sr += r;
      sg += g;
      sb += b;
      sumLum += lum;
      sumLumSq += lum * lum;
      if (lum < darkPixelLum) darkCount++;
      rowSum += lum;
      rowN++;
      count++;
    }
    if (rowN > 0) rowLums.push(rowSum / rowN);
  }

  const colLums: number[] = [];
  for (let px = x0; px < x1; px++) {
    let colSum = 0;
    let colN = 0;
    for (let py = y0; py < y1; py++) {
      const i = (py * mapW + px) * 4;
      if (data[i + 3]! < 16) continue;
      colSum += luminance(data[i]!, data[i + 1]!, data[i + 2]!);
      colN++;
    }
    if (colN > 0) colLums.push(colSum / colN);
  }

  if (count === 0) return null;
  const avgLum = sumLum / count;
  const variance = Math.max(0, sumLumSq / count - avgLum * avgLum);
  const stripe = Math.max(stripeScore(rowLums), stripeScore(colLums));

  return { r: sr / count, g: sg / count, b: sb / count, lum: avgLum, variance, darkRatio: darkCount / count, stripe };
}

function stripeScore(profile: number[]): number {
  if (profile.length < 4) return 0;
  const mean = profile.reduce((a, v) => a + v, 0) / profile.length;
  let transitions = 0;
  let prevAbove = profile[0]! > mean;
  for (let i = 1; i < profile.length; i++) {
    const above = profile[i]! > mean;
    if (above !== prevAbove) transitions++;
    prevAbove = above;
  }
  return transitions * 0.15 + (Math.max(...profile) - Math.min(...profile)) * 0.01;
}

/** Red/orange baked lighting on dungeon maps — not geometry. */
function isAmbientGlow(stats: CellStats): boolean {
  if (stats.r > stats.g + 18 && stats.r > stats.b + 14 && stats.lum > 45 && stats.lum < 220) return true;
  if (stats.r > 120 && stats.g < stats.r * 0.72 && stats.b < stats.r * 0.55 && stats.lum > 40) return true;
  return false;
}

function isTorchColor(stats: CellStats): boolean {
  return stats.r > 175 && stats.g > 70 && stats.g < 170 && stats.b < 90 && stats.lum > 90;
}

function isWater(stats: CellStats): boolean {
  return stats.b > stats.r + 14 && stats.b > stats.g + 6 && stats.lum > 40 && stats.lum < 195 && stats.b > 55;
}

function isWoodTone(stats: CellStats): boolean {
  return stats.r > stats.b + 8 && stats.g > stats.b && stats.lum > 68 && stats.lum < 175 && stats.darkRatio < 0.28;
}

function isWall(stats: CellStats, opts: Required<MapSceneScanOptions>): boolean {
  if (isAmbientGlow(stats) || isWater(stats) || isTorchColor(stats)) return false;
  if (isWoodTone(stats)) return false;
  if (stats.lum < 48) return true;
  if (stats.lum < opts.threshold && stats.darkRatio >= opts.darkRatio) return true;
  return false;
}

function isStairs(stats: CellStats): boolean {
  return stats.stripe >= 1.45 && stats.lum > 55 && stats.lum < 175 && stats.variance > 200 && !isAmbientGlow(stats);
}

function localFloorLum(statsGrid: (CellStats | null)[], wallRaw: Uint8Array, cols: number, rows: number, cx: number, cy: number, fallback: number): number {
  const vals: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const idx = ny * cols + nx;
      if (wallRaw[idx]) continue;
      const st = statsGrid[idx];
      if (st && !isAmbientGlow(st)) vals.push(st.lum);
    }
  }
  if (vals.length === 0) return fallback;
  vals.sort((a, b) => a - b);
  return vals[Math.floor(vals.length / 2)]!;
}

function isFurnitureBlob(stats: CellStats, localLum: number, opts: Required<MapSceneScanOptions>): boolean {
  if (isWall(stats, opts) || isWater(stats) || isAmbientGlow(stats)) return false;
  const dl = Math.abs(stats.lum - localLum);
  if (dl < 22 && stats.variance < 200) return false;
  if (isWoodTone(stats) && dl > 12) return true;
  if (dl > 35 && stats.lum > 40 && stats.lum < 200) return true;
  if (stats.variance > 320 && stats.darkRatio > 0.06 && stats.darkRatio < 0.55) return true;
  return false;
}

type Component = {
  cells: Array<{ x: number; y: number }>;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  avgR: number;
  avgG: number;
  avgB: number;
  avgLum: number;
  avgStripe: number;
};

function floodBinary(
  mask: Uint8Array,
  statsGrid: (CellStats | null)[],
  cols: number,
  rows: number,
  sx: number,
  sy: number,
  visited: Uint8Array,
): Component | null {
  const start = sy * cols + sx;
  if (!mask[start] || visited[start]) return null;

  const cells: Array<{ x: number; y: number }> = [];
  let minX = sx;
  let maxX = sx;
  let minY = sy;
  let maxY = sy;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let sl = 0;
  let ss = 0;
  const stack = [{ x: sx, y: sy }];

  while (stack.length > 0) {
    const p = stack.pop()!;
    const idx = p.y * cols + p.x;
    if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows || !mask[idx] || visited[idx]) continue;
    visited[idx] = 1;
    cells.push(p);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    const st = statsGrid[idx];
    if (st) {
      sr += st.r;
      sg += st.g;
      sb += st.b;
      sl += st.lum;
      ss += st.stripe;
    }
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }

  if (cells.length === 0) return null;
  const n = cells.length;
  return {
    cells,
    minX,
    maxX,
    minY,
    maxY,
    avgR: sr / n,
    avgG: sg / n,
    avgB: sb / n,
    avgLum: sl / n,
    avgStripe: ss / n,
  };
}

function floodComponent(
  types: Uint8Array,
  statsGrid: (CellStats | null)[],
  cols: number,
  rows: number,
  sx: number,
  sy: number,
  typeId: number,
  visited: Uint8Array,
): Component | null {
  const start = sy * cols + sx;
  if (types[start] !== typeId || visited[start]) return null;
  const mask = new Uint8Array(cols * rows);
  for (let i = 0; i < types.length; i++) if (types[i] === typeId) mask[i] = 1;
  return floodBinary(mask, statsGrid, cols, rows, sx, sy, visited);
}

function collectComponents(types: Uint8Array, statsGrid: (CellStats | null)[], cols: number, rows: number, typeId: number): Component[] {
  const visited = new Uint8Array(cols * rows);
  const out: Component[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const comp = floodComponent(types, statsGrid, cols, rows, x, y, typeId, visited);
      if (comp) out.push(comp);
    }
  }
  return out;
}

function isWoodToneComp(comp: Pick<Component, 'avgR' | 'avgG' | 'avgB' | 'avgLum'>): boolean {
  return comp.avgR > comp.avgB + 8 && comp.avgG > comp.avgB && comp.avgLum > 68 && comp.avgLum < 175;
}

function classifyProp(comp: Component): PropKind {
  const w = comp.maxX - comp.minX + 1;
  const h = comp.maxY - comp.minY + 1;
  const area = comp.cells.length;
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));

  if (comp.avgB > comp.avgR + 15 && comp.avgB > 70) return area <= 12 ? 'fountain' : 'water';
  if (comp.avgStripe >= 1.25 && area >= 2) return 'stairs';
  if (aspect >= 2.8 && area >= 3 && area <= 18) return 'shelf';
  if (aspect >= 1.4 && aspect <= 2.6 && area >= 2 && area <= 10 && isWoodToneComp(comp)) return 'bed';
  if (area <= 2 && aspect < 1.8) return 'chair';
  if (area >= 3 && area <= 14 && aspect >= 2.2) return 'bench';
  if (area >= 3 && area <= 20 && aspect < 2.2) return 'table';
  if (area === 1 && comp.avgLum < 75) return 'pillar';
  return 'prop';
}

function classifyWater(comp: Component): 'pool' | 'fountain' {
  const w = comp.maxX - comp.minX + 1;
  const h = comp.maxY - comp.minY + 1;
  if (comp.cells.length <= 16 && Math.max(w, h) / Math.max(1, Math.min(w, h)) < 1.6) return 'fountain';
  return 'pool';
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
          if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) out[ny * cols + nx] = 1;
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

function morphOpen(cells: Uint8Array, cols: number, rows: number): Uint8Array {
  return dilate(erode(cells, cols, rows), cols, rows);
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

/** Drop boundary voxels floating in void (noise) — keep only walls bordering open floor. */
function pruneBoundaryNoise(wallCells: Uint8Array, wallRaw: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = Uint8Array.from(wallCells);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!out[idx]) continue;
      let nearFloor = false;
      for (let dy = -2; dy <= 2 && !nearFloor; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (!wallRaw[ny * cols + nx]) {
            nearFloor = true;
            break;
          }
        }
      }
      if (!nearFloor) out[idx] = 0;
    }
  }
  return out;
}

function removeTinyWallComponents(wallCells: Uint8Array, cols: number, rows: number, minSize: number): Uint8Array {
  const out = new Uint8Array(wallCells.length);
  const visited = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const comp = floodBinary(wallCells, new Array(cols * rows).fill(null), cols, rows, x, y, visited);
      if (!comp || comp.cells.length < minSize) continue;
      for (const c of comp.cells) out[c.y * cols + c.x] = 1;
    }
  }
  return out;
}

export function extractWallSegments(
  wallCells: Uint8Array,
  cols: number,
  rows: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
): ScannedWallSegment[] {
  const gs = map.gridSize;
  const ox = map.x + map.gridOffsetX;
  const oz = map.y + map.gridOffsetY;
  const used = new Uint8Array(cols * rows);
  const segs: ScannedWallSegment[] = [];

  for (let y = 0; y < rows; y++) {
    let x = 0;
    while (x < cols) {
      const idx = y * cols + x;
      if (!wallCells[idx] || used[idx]) {
        x++;
        continue;
      }
      const x0 = x;
      while (x < cols && wallCells[y * cols + x] && !used[y * cols + x]) x++;
      const len = x - x0;
      for (let xi = x0; xi < x; xi++) used[y * cols + xi] = 1;
      if (len >= 1) {
        segs.push({
          id: `wh-${segs.length}`,
          cx: ox + (x0 + len / 2) * gs,
          cz: oz + (y + 0.5) * gs,
          length: len * gs * 0.96,
          thickness: gs * 0.88,
          rotation: 0,
        });
      }
    }
  }

  for (let x = 0; x < cols; x++) {
    let y = 0;
    while (y < rows) {
      const idx = y * cols + x;
      if (!wallCells[idx] || used[idx]) {
        y++;
        continue;
      }
      const y0 = y;
      while (y < rows && wallCells[y * cols + x] && !used[y * cols + x]) y++;
      const len = y - y0;
      for (let yi = y0; yi < y; yi++) used[yi * cols + x] = 1;
      if (len >= 1) {
        segs.push({
          id: `wv-${segs.length}`,
          cx: ox + (x + 0.5) * gs,
          cz: oz + (y0 + len / 2) * gs,
          length: len * gs * 0.96,
          thickness: gs * 0.88,
          rotation: Math.PI / 2,
        });
      }
    }
  }

  return segs;
}

function cellToWorld(
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
  cx: number,
  cy: number,
): { wx: number; wz: number } {
  const gs = map.gridSize;
  return { wx: map.x + map.gridOffsetX + cx * gs, wz: map.y + map.gridOffsetY + cy * gs };
}

function detectPits(
  wallRaw: Uint8Array,
  wallCells: Uint8Array,
  cols: number,
  rows: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
): ScannedPit[] {
  const interior = new Uint8Array(cols * rows);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const idx = y * cols + x;
      if (!wallRaw[idx] || wallCells[idx]) continue;
      if (wallRaw[idx - 1] && wallRaw[idx + 1] && wallRaw[idx - cols] && wallRaw[idx + cols]) interior[idx] = 1;
    }
  }

  const pits: ScannedPit[] = [];
  const visited = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const comp = floodBinary(interior, new Array(cols * rows).fill(null), cols, rows, x, y, visited);
      if (!comp || comp.cells.length < 3) continue;
      const w = comp.maxX - comp.minX + 1;
      const h = comp.maxY - comp.minY + 1;
      if (Math.max(w, h) / Math.max(1, Math.min(w, h)) > 2.2) continue;
      const { wx, wz } = cellToWorld(map, (comp.minX + comp.maxX + 1) / 2, (comp.minY + comp.maxY + 1) / 2);
      pits.push({ id: `pit-${pits.length}`, cx: wx, cz: wz, radiusCells: Math.max(w, h) / 2 });
    }
  }
  return pits;
}

function scanFurnitureAtSubGrid(
  data: Uint8ClampedArray,
  sampleW: number,
  sampleH: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
  cols: number,
  rows: number,
  scaledGrid: number,
  scaledOffsetX: number,
  scaledOffsetY: number,
  wallRaw: Uint8Array,
  statsGrid: (CellStats | null)[],
  floorLum: number,
  opts: Required<MapSceneScanOptions>,
): ScannedProp[] {
  const SUB = 4;
  const subCols = cols * SUB;
  const subRows = rows * SUB;
  const furniture = new Uint8Array(subCols * subRows);
  const subStats: (CellStats | null)[] = new Array(subCols * subRows).fill(null);

  for (let sy = 0; sy < subRows; sy++) {
    for (let sx = 0; sx < subCols; sx++) {
      const cx = Math.floor(sx / SUB);
      const cy = Math.floor(sy / SUB);
      if (wallRaw[cy * cols + cx]) continue;

      const x0 = Math.min(sampleW - 1, Math.max(0, scaledOffsetX + Math.floor((sx * scaledGrid) / SUB)));
      const y0 = Math.min(sampleH - 1, Math.max(0, scaledOffsetY + Math.floor((sy * scaledGrid) / SUB)));
      const x1 = Math.min(sampleW, x0 + Math.max(2, Math.ceil(scaledGrid / SUB)));
      const y1 = Math.min(sampleH, y0 + Math.max(2, Math.ceil(scaledGrid / SUB)));
      const stats = sampleCellStats(data, sampleW, sampleH, x0, y0, x1, y1, opts.darkPixelLum);
      if (!stats) continue;
      subStats[sy * subCols + sx] = stats;
      const local = localFloorLum(statsGrid, wallRaw, cols, rows, cx, cy, floorLum);
      if (isFurnitureBlob(stats, local, opts)) furniture[sy * subCols + sx] = 1;
    }
  }

  const props: ScannedProp[] = [];
  const visited = new Uint8Array(subCols * subRows);
  const gs = map.gridSize;

  for (let sy = 0; sy < subRows; sy++) {
    for (let sx = 0; sx < subCols; sx++) {
      if (!furniture[sy * subCols + sx] || visited[sy * subCols + sx]) continue;
      const comp = floodBinary(furniture, subStats, subCols, subRows, sx, sy, visited);
      if (!comp || comp.cells.length < 2 || comp.cells.length > 48) continue;

      const w = (comp.maxX - comp.minX + 1) / SUB;
      const h = (comp.maxY - comp.minY + 1) / SUB;
      const fcx = (comp.minX + comp.maxX + 1) / 2 / SUB;
      const fcy = (comp.minY + comp.maxY + 1) / 2 / SUB;
      const { wx, wz } = cellToWorld(map, fcx, fcy);

      const tooClose = props.some((p) => Math.hypot(p.cx - wx, p.cz - wz) < gs * 0.55);
      if (tooClose) continue;

      const kind = classifyProp(comp);
      props.push({
        id: `fur-${props.length}`,
        kind: kind === 'water' || kind === 'fountain' ? 'prop' : kind,
        cx: wx,
        cz: wz,
        widthCells: Math.max(0.35, w * 0.92),
        depthCells: Math.max(0.35, h * 0.92),
        rotation: w >= h ? 0 : Math.PI / 2,
      });
      if (props.length >= 120) break;
    }
    if (props.length >= 120) break;
  }
  return props;
}

function scanTorches(
  data: Uint8ClampedArray,
  sampleW: number,
  sampleH: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
  wallRaw: Uint8Array,
  cols: number,
  rows: number,
  scaledGrid: number,
  scaledOffsetX: number,
  scaledOffsetY: number,
): ScannedProp[] {
  const torches: ScannedProp[] = [];
  const gs = map.gridSize;
  const step = Math.max(2, Math.floor(scaledGrid / 6));

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      if (!wallRaw[cy * cols + cx]) continue;
      const x0 = scaledOffsetX + cx * scaledGrid;
      const y0 = scaledOffsetY + cy * scaledGrid;
      for (let py = y0; py < y0 + scaledGrid; py += step) {
        for (let px = x0; px < x0 + scaledGrid; px += step) {
          if (px >= sampleW || py >= sampleH) continue;
          const i = (py * sampleW + px) * 4;
          const stats: CellStats = {
            r: data[i]!,
            g: data[i + 1]!,
            b: data[i + 2]!,
            lum: luminance(data[i]!, data[i + 1]!, data[i + 2]!),
            variance: 0,
            darkRatio: 0,
            stripe: 0,
          };
          if (!isTorchColor(stats)) continue;
          const { wx, wz } = cellToWorld(map, cx + 0.5, cy + 0.5);
          if (torches.some((t) => Math.hypot(t.cx - wx, t.cz - wz) < gs * 0.8)) continue;
          torches.push({
            id: `torch-${torches.length}`,
            kind: 'torch',
            cx: wx,
            cz: wz,
            widthCells: 0.25,
            depthCells: 0.25,
            rotation: 0,
          });
          if (torches.length >= 40) return torches;
        }
      }
    }
  }
  return torches;
}

export async function scanMapImageForScene(
  map: Pick<MapItem, 'id' | 'backgroundUrl' | 'width' | 'height' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY' | 'x' | 'y'>,
  options?: MapSceneScanOptions,
): Promise<MapSceneScanResult | null> {
  if (!map.backgroundUrl) return null;

  const opts = { ...DEFAULTS, ...options };
  const gridSize = Math.max(4, map.gridSize);
  const cols = Math.ceil(map.width / gridSize);
  const rows = Math.ceil(map.height / gridSize);

  const img = await loadImageUrl(map.backgroundUrl);
  const maxDim = 2800;
  const scale = Math.min(1, maxDim / Math.max(map.width, map.height));
  const sampleW = Math.max(32, Math.round(map.width * scale));
  const sampleH = Math.max(32, Math.round(map.height * scale));
  const data = readImagePixels(img, sampleW, sampleH);
  if (!data) return null;

  const scaledGrid = Math.max(4, Math.round(gridSize * scale));
  const scaledOffsetX = Math.round(map.gridOffsetX * scale);
  const scaledOffsetY = Math.round(map.gridOffsetY * scale);

  const statsGrid: (CellStats | null)[] = new Array(cols * rows).fill(null);
  const types = new Uint8Array(cols * rows);
  let floorLumSum = 0;
  let floorCount = 0;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.min(sampleW - 1, Math.max(0, scaledOffsetX + cx * scaledGrid));
      const y0 = Math.min(sampleH - 1, Math.max(0, scaledOffsetY + cy * scaledGrid));
      const stats = sampleCellStats(data, sampleW, sampleH, x0, y0, Math.min(sampleW, x0 + scaledGrid), Math.min(sampleH, y0 + scaledGrid), opts.darkPixelLum);
      if (!stats) continue;
      statsGrid[cy * cols + cx] = stats;
      if (!isWall(stats, opts) && !isWater(stats) && !isAmbientGlow(stats)) {
        floorLumSum += stats.lum;
        floorCount++;
      }
    }
  }
  const floorLum = floorCount > 0 ? floorLumSum / floorCount : 140;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx;
      const stats = statsGrid[idx];
      if (!stats) continue;
      if (isWall(stats, opts)) types[idx] = CELL_WALL;
      else if (isWater(stats)) types[idx] = CELL_WATER;
      else if (isStairs(stats)) types[idx] = CELL_STAIRS;
      else if (isFurnitureBlob(stats, localFloorLum(statsGrid, new Uint8Array(cols * rows), cols, rows, cx, cy, floorLum), opts)) {
        types[idx] = CELL_DETAIL;
      }
    }
  }

  let wallRaw: Uint8Array = new Uint8Array(cols * rows);
  for (let i = 0; i < types.length; i++) {
    if (types[i] === CELL_WALL) wallRaw[i] = 1;
  }
  wallRaw = Uint8Array.from(morphClose(wallRaw, cols, rows));
  wallRaw = Uint8Array.from(morphOpen(wallRaw, cols, rows));

  let wallCells = boundaryWallCells(wallRaw, cols, rows);
  wallCells = pruneBoundaryNoise(wallCells, wallRaw, cols, rows);
  wallCells = removeTinyWallComponents(wallCells, cols, rows, 2);

  const wallSegments = extractWallSegments(wallCells, cols, rows, map);

  const waters: ScannedWater[] = [];
  for (const [i, comp] of collectComponents(types, statsGrid, cols, rows, CELL_WATER).entries()) {
    if (comp.cells.length > cols * rows * 0.3) continue;
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const { wx, wz } = cellToWorld(map, (comp.minX + comp.maxX + 1) / 2, (comp.minY + comp.maxY + 1) / 2);
    waters.push({ id: `water-${i}`, cx: wx, cz: wz, radiusCells: Math.max(w, h) / 2, kind: classifyWater(comp) });
  }

  const stairs: ScannedStairs[] = [];
  for (const [i, comp] of collectComponents(types, statsGrid, cols, rows, CELL_STAIRS).entries()) {
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const { wx, wz } = cellToWorld(map, (comp.minX + comp.maxX + 1) / 2, (comp.minY + comp.maxY + 1) / 2);
    stairs.push({
      id: `stairs-${i}`,
      cx: wx,
      cz: wz,
      widthCells: w,
      depthCells: h,
      rotation: w >= h ? 0 : Math.PI / 2,
      steps: Math.min(6, Math.max(2, Math.round(Math.max(w, h)))),
    });
  }

  const cellProps: ScannedProp[] = [];
  for (const comp of collectComponents(types, statsGrid, cols, rows, CELL_DETAIL)) {
    if (comp.cells.length > 20 || comp.cells.length < 1) continue;
    const kind = classifyProp(comp);
    if (kind === 'water' || kind === 'fountain') continue;
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const { wx, wz } = cellToWorld(map, (comp.minX + comp.maxX + 1) / 2, (comp.minY + comp.maxY + 1) / 2);
    if (kind === 'stairs') {
      stairs.push({ id: `stairs-d-${stairs.length}`, cx: wx, cz: wz, widthCells: w, depthCells: h, rotation: w >= h ? 0 : Math.PI / 2, steps: Math.min(5, Math.max(2, Math.round(Math.max(w, h)))) });
      continue;
    }
    cellProps.push({ id: `cell-${cellProps.length}`, kind, cx: wx, cz: wz, widthCells: w, depthCells: h, rotation: w >= h ? 0 : Math.PI / 2 });
    if (cellProps.length >= 40) break;
  }

  const furniture = scanFurnitureAtSubGrid(data, sampleW, sampleH, map, cols, rows, scaledGrid, scaledOffsetX, scaledOffsetY, wallRaw, statsGrid, floorLum, opts);
  const torches = scanTorches(data, sampleW, sampleH, map, wallRaw, cols, rows, scaledGrid, scaledOffsetX, scaledOffsetY);
  const props = [...cellProps, ...furniture, ...torches];

  const pits = detectPits(wallRaw, wallCells, cols, rows, map);

  let wallCellCount = 0;
  for (let i = 0; i < wallCells.length; i++) if (wallCells[i]) wallCellCount++;

  return {
    cols,
    rows,
    wallCells,
    wallSegments,
    wallCellCount,
    props,
    waters,
    stairs,
    pits,
    featureCount: wallSegments.length + props.length + waters.length + stairs.length + pits.length,
  };
}

export function sceneScanCacheKey(
  map: Pick<MapItem, 'id' | 'backgroundUrl' | 'width' | 'height' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>,
  threshold: number,
): string {
  return `scene|v4|${map.id}|${map.backgroundUrl ?? ''}|${map.width}x${map.height}|${map.gridSize}|${map.gridOffsetX},${map.gridOffsetY}|t${threshold}`;
}
