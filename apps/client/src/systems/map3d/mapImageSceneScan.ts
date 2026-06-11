import { loadImageUrl } from '@/lib/textureLoader';
import type { MapItem } from '@/systems/scene/types';

export type PropKind = 'chair' | 'table' | 'bench' | 'stairs' | 'fountain' | 'water' | 'pillar' | 'prop';

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

export type MapSceneScanResult = {
  cols: number;
  rows: number;
  wallCells: Uint8Array;
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
  threshold: 98,
  darkRatio: 0.38,
  darkPixelLum: 72,
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
      const a = data[i + 3]!;
      if (a < 16) continue;
      colSum += luminance(data[i]!, data[i + 1]!, data[i + 2]!);
      colN++;
    }
    if (colN > 0) colLums.push(colSum / colN);
  }

  if (count === 0) return null;
  const avgLum = sumLum / count;
  const variance = Math.max(0, sumLumSq / count - avgLum * avgLum);
  const stripe = Math.max(stripeScore(rowLums), stripeScore(colLums));

  return {
    r: sr / count,
    g: sg / count,
    b: sb / count,
    lum: avgLum,
    variance,
    darkRatio: darkCount / count,
    stripe,
  };
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
  const swing = Math.max(...profile) - Math.min(...profile);
  return transitions * 0.15 + swing * 0.01;
}

function isWater(stats: CellStats): boolean {
  return stats.b > stats.r + 12 && stats.b > stats.g + 4 && stats.lum > 35 && stats.lum < 200 && stats.b > 60;
}

function isWall(stats: CellStats, opts: Required<MapSceneScanOptions>): boolean {
  return stats.lum < opts.threshold || stats.darkRatio >= opts.darkRatio;
}

function isStairs(stats: CellStats): boolean {
  return stats.stripe >= 1.35 && stats.lum > 50 && stats.lum < 190 && stats.variance > 180;
}

function isDetail(stats: CellStats, floorLum: number): boolean {
  if (Math.abs(stats.lum - floorLum) < 18 && stats.variance < 160) return false;
  if (stats.variance > 220) return true;
  if (Math.abs(stats.lum - floorLum) > 32 && stats.lum > 35 && stats.lum < 215) return true;
  if (stats.darkRatio > 0.08 && stats.darkRatio < 0.62 && stats.lum > 45) return true;
  return false;
}

function isSubCellProp(stats: CellStats, floorLum: number, opts: Required<MapSceneScanOptions>): boolean {
  if (isWall(stats, opts) || isWater(stats)) return false;
  if (Math.abs(stats.lum - floorLum) < 16 && stats.variance < 140) return false;
  return stats.variance > 180 || Math.abs(stats.lum - floorLum) > 24 || stats.darkRatio > 0.1;
}

function classifySubProp(stats: CellStats, floorLum: number): PropKind {
  if (stats.darkRatio > 0.35 && stats.lum < floorLum - 20) return 'prop';
  if (stats.lum < floorLum - 35) return 'chair';
  if (stats.variance > 500) return 'table';
  return 'prop';
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
    if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows) continue;
    if (types[idx] !== typeId || visited[idx]) continue;
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
    stack.push({ x: p.x + 1, y: p.y });
    stack.push({ x: p.x - 1, y: p.y });
    stack.push({ x: p.x, y: p.y + 1 });
    stack.push({ x: p.x, y: p.y - 1 });
  }

  if (cells.length === 0) return null;
  return {
    cells,
    minX,
    maxX,
    minY,
    maxY,
    avgR: sr / cells.length,
    avgG: sg / cells.length,
    avgB: sb / cells.length,
    avgLum: sl / cells.length,
    avgStripe: ss / cells.length,
  };
}

function collectComponents(
  types: Uint8Array,
  statsGrid: (CellStats | null)[],
  cols: number,
  rows: number,
  typeId: number,
): Component[] {
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

function classifyProp(comp: Component): PropKind {
  const w = comp.maxX - comp.minX + 1;
  const h = comp.maxY - comp.minY + 1;
  const area = comp.cells.length;
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));

  if (comp.avgB > comp.avgR + 15 && comp.avgB > 70) return area <= 12 ? 'fountain' : 'water';
  if (comp.avgStripe >= 1.2 && area >= 2) return 'stairs';
  if (area <= 2 && aspect < 1.8) return 'chair';
  if (area >= 3 && area <= 14 && aspect >= 2.2) return 'bench';
  if (area >= 3 && area <= 20 && aspect < 2.2) return 'table';
  if (area === 1 && comp.avgLum < 80) return 'pillar';
  return 'prop';
}

function classifyWater(comp: Component): 'pool' | 'fountain' {
  const w = comp.maxX - comp.minX + 1;
  const h = comp.maxY - comp.minY + 1;
  const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
  if (comp.cells.length <= 16 && aspect < 1.6) return 'fountain';
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

function cellToWorld(
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
  cx: number,
  cy: number,
): { wx: number; wz: number } {
  const gs = map.gridSize;
  return {
    wx: map.x + map.gridOffsetX + cx * gs,
    wz: map.y + map.gridOffsetY + cy * gs,
  };
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
      if (wallRaw[idx - 1] && wallRaw[idx + 1] && wallRaw[idx - cols] && wallRaw[idx + cols]) {
        interior[idx] = 1;
      }
    }
  }

  const pits: ScannedPit[] = [];
  const visited = new Uint8Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const comp = floodComponent(
        interior,
        new Array(cols * rows).fill(null),
        cols,
        rows,
        x,
        y,
        1,
        visited,
      );
      if (!comp || comp.cells.length < 4) continue;
      const w = comp.maxX - comp.minX + 1;
      const h = comp.maxY - comp.minY + 1;
      const aspect = Math.max(w, h) / Math.max(1, Math.min(w, h));
      if (aspect > 2.2) continue;
      const cx = (comp.minX + comp.maxX + 1) / 2;
      const cy = (comp.minY + comp.maxY + 1) / 2;
      const { wx, wz } = cellToWorld(map, cx, cy);
      pits.push({
        id: `pit-${pits.length}`,
        cx: wx,
        cz: wz,
        radiusCells: Math.max(w, h) / 2,
      });
    }
  }
  return pits;
}

function scanSubCellProps(
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
  types: Uint8Array,
  floorLum: number,
  opts: Required<MapSceneScanOptions>,
  existing: ScannedProp[],
  limit: number,
): ScannedProp[] {
  const SUB = 3;
  const out: ScannedProp[] = [];
  const gs = map.gridSize;

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx;
      if (wallRaw[idx] || types[idx] === CELL_WATER || types[idx] === CELL_STAIRS) continue;

      for (let sy = 0; sy < SUB; sy++) {
        for (let sx = 0; sx < SUB; sx++) {
          const x0 = Math.min(
            sampleW - 1,
            Math.max(0, scaledOffsetX + cx * scaledGrid + Math.floor((sx * scaledGrid) / SUB)),
          );
          const y0 = Math.min(
            sampleH - 1,
            Math.max(0, scaledOffsetY + cy * scaledGrid + Math.floor((sy * scaledGrid) / SUB)),
          );
          const x1 = Math.min(sampleW, x0 + Math.max(2, Math.ceil(scaledGrid / SUB)));
          const y1 = Math.min(sampleH, y0 + Math.max(2, Math.ceil(scaledGrid / SUB)));
          const stats = sampleCellStats(data, sampleW, sampleH, x0, y0, x1, y1, opts.darkPixelLum);
          if (!stats || !isSubCellProp(stats, floorLum, opts)) continue;

          const fcx = cx + (sx + 0.5) / SUB;
          const fcy = cy + (sy + 0.5) / SUB;
          const { wx, wz } = cellToWorld(map, fcx, fcy);
          const tooClose = [...existing, ...out].some(
            (p) => Math.hypot(p.cx - wx, p.cz - wz) < gs * 0.35,
          );
          if (tooClose) continue;

          out.push({
            id: `sub-${out.length}`,
            kind: classifySubProp(stats, floorLum),
            cx: wx,
            cz: wz,
            widthCells: 0.85 / SUB,
            depthCells: 0.85 / SUB,
            rotation: (sx + sy) % 2 === 0 ? 0 : Math.PI / 4,
          });
          if (out.length >= limit) return out;
        }
      }
    }
  }
  return out;
}

const MAX_PROPS = 800;

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
  const maxDim = 2400;
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
      const x1 = Math.min(sampleW, x0 + scaledGrid);
      const y1 = Math.min(sampleH, y0 + scaledGrid);
      const stats = sampleCellStats(data, sampleW, sampleH, x0, y0, x1, y1, opts.darkPixelLum);
      if (!stats) continue;
      statsGrid[cy * cols + cx] = stats;
      if (!isWall(stats, opts) && !isWater(stats)) {
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
      else if (isDetail(stats, floorLum)) types[idx] = CELL_DETAIL;
    }
  }

  let wallRaw: Uint8Array = new Uint8Array(cols * rows);
  for (let i = 0; i < types.length; i++) {
    if (types[i] === CELL_WALL) wallRaw[i] = 1;
  }
  wallRaw = Uint8Array.from(morphClose(wallRaw, cols, rows));
  pruneIsolated(wallRaw, cols, rows);
  const wallCells = boundaryWallCells(wallRaw, cols, rows);

  for (let i = 0; i < types.length; i++) {
    if (types[i] === CELL_DETAIL && wallRaw[i]) types[i] = CELL_FLOOR;
  }

  const waters: ScannedWater[] = [];
  for (const [i, comp] of collectComponents(types, statsGrid, cols, rows, CELL_WATER).entries()) {
    if (comp.cells.length > cols * rows * 0.35) continue;
    const cx = (comp.minX + comp.maxX + 1) / 2;
    const cy = (comp.minY + comp.maxY + 1) / 2;
    const { wx, wz } = cellToWorld(map, cx, cy);
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    waters.push({
      id: `water-${i}`,
      cx: wx,
      cz: wz,
      radiusCells: Math.max(w, h) / 2,
      kind: classifyWater(comp),
    });
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
    for (const c of comp.cells) types[c.y * cols + c.x] = CELL_FLOOR;
  }

  const props: ScannedProp[] = [];
  for (const comp of collectComponents(types, statsGrid, cols, rows, CELL_DETAIL)) {
    if (comp.cells.length > 24 || comp.cells.length < 1) continue;
    const kind = classifyProp(comp);
    const w = comp.maxX - comp.minX + 1;
    const h = comp.maxY - comp.minY + 1;
    const { wx, wz } = cellToWorld(map, (comp.minX + comp.maxX + 1) / 2, (comp.minY + comp.maxY + 1) / 2);

    if (kind === 'water') continue;
    if (kind === 'stairs') {
      stairs.push({
        id: `stairs-d-${stairs.length}`,
        cx: wx,
        cz: wz,
        widthCells: w,
        depthCells: h,
        rotation: w >= h ? 0 : Math.PI / 2,
        steps: Math.min(5, Math.max(2, Math.round(Math.max(w, h)))),
      });
      continue;
    }
    if (kind === 'fountain') {
      waters.push({
        id: `fountain-${waters.length}`,
        cx: wx,
        cz: wz,
        radiusCells: Math.max(w, h) / 2,
        kind: 'fountain',
      });
      continue;
    }

    props.push({
      id: `prop-${props.length}`,
      kind,
      cx: wx,
      cz: wz,
      widthCells: w,
      depthCells: h,
      rotation: w >= h ? 0 : Math.PI / 2,
    });
    if (props.length >= MAX_PROPS) break;
  }

  const subProps = scanSubCellProps(
    data,
    sampleW,
    sampleH,
    map,
    cols,
    rows,
    scaledGrid,
    scaledOffsetX,
    scaledOffsetY,
    wallRaw,
    types,
    floorLum,
    opts,
    props,
    MAX_PROPS - props.length,
  );
  props.push(...subProps);

  const pits = detectPits(wallRaw, wallCells, cols, rows, map);

  let wallCellCount = 0;
  for (let i = 0; i < wallCells.length; i++) {
    if (wallCells[i]) wallCellCount++;
  }

  return {
    cols,
    rows,
    wallCells,
    wallCellCount,
    props,
    waters,
    stairs,
    pits,
    featureCount: wallCellCount + props.length + waters.length + stairs.length + pits.length,
  };
}

export function sceneScanCacheKey(
  map: Pick<MapItem, 'id' | 'backgroundUrl' | 'width' | 'height' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>,
  threshold: number,
): string {
  return `scene|v3|${map.id}|${map.backgroundUrl ?? ''}|${map.width}x${map.height}|${map.gridSize}|${map.gridOffsetX},${map.gridOffsetY}|t${threshold}`;
}
