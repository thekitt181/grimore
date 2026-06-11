import { loadImageUrl } from '@/lib/textureLoader';
import type { MapItem } from '@/systems/scene/types';

/** @deprecated Props disabled — walls-only scan */
export type PropKind = 'prop';

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

export type ScannedDoor = {
  id: string;
  cx: number;
  cz: number;
  widthCells: number;
  rotation: number;
};

export type MapSceneScanResult = {
  cols: number;
  rows: number;
  wallCells: Uint8Array;
  wallSegments: ScannedWallSegment[];
  doors: ScannedDoor[];
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
  threshold: 70,
  darkRatio: 0.52,
  darkPixelLum: 58,
};

type CellStats = {
  r: number;
  g: number;
  b: number;
  lum: number;
  darkRatio: number;
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
      sr += r;
      sg += g;
      sb += b;
      sumLum += lum;
      if (lum < darkPixelLum) darkCount++;
      count++;
    }
  }

  if (count === 0) return null;
  return { r: sr / count, g: sg / count, b: sb / count, lum: sumLum / count, darkRatio: darkCount / count };
}

function isAmbientGlow(stats: CellStats): boolean {
  if (stats.r > stats.g + 18 && stats.r > stats.b + 14 && stats.lum > 45 && stats.lum < 220) return true;
  if (stats.r > 120 && stats.g < stats.r * 0.72 && stats.b < stats.r * 0.55 && stats.lum > 40) return true;
  return false;
}

function isWater(stats: CellStats): boolean {
  return stats.b > stats.r + 14 && stats.b > stats.g + 6 && stats.lum > 40 && stats.lum < 195 && stats.b > 55;
}

function isWoodTone(stats: CellStats): boolean {
  return stats.r > stats.b + 8 && stats.g > stats.b && stats.lum > 68 && stats.lum < 175 && stats.darkRatio < 0.28;
}

/** Strict wall test — only thick dark map borders, not furniture or lighting. */
function isWall(stats: CellStats, opts: Required<MapSceneScanOptions>): boolean {
  if (isAmbientGlow(stats) || isWater(stats) || isWoodTone(stats)) return false;
  if (stats.lum < 42 && stats.darkRatio >= 0.35) return true;
  if (stats.lum < opts.threshold && stats.darkRatio >= opts.darkRatio) return true;
  return false;
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

/** Dark blobs fully enclosed by floor (pits) are not walls. */
function removeEnclosedVoids(wallMask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = Uint8Array.from(wallMask);
  const visited = new Uint8Array(cols * rows);
  const stack: Array<{ x: number; y: number }> = [];

  for (let x = 0; x < cols; x++) {
    stack.push({ x, y: 0 }, { x, y: rows - 1 });
  }
  for (let y = 1; y < rows - 1; y++) {
    stack.push({ x: 0, y }, { x: cols - 1, y });
  }

  while (stack.length > 0) {
    const p = stack.pop()!;
    const idx = p.y * cols + p.x;
    if (p.x < 0 || p.y < 0 || p.x >= cols || p.y >= rows || visited[idx] || wallMask[idx]) continue;
    visited[idx] = 1;
    stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
  }

  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const idx = y * cols + x;
      if (!wallMask[idx] || visited[idx]) continue;
      let touchesOpen = false;
      for (let dy = -1; dy <= 1 && !touchesOpen; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (!wallMask[ny * cols + nx] && visited[ny * cols + nx]) {
            touchesOpen = true;
            break;
          }
        }
      }
      if (!touchesOpen) out[idx] = 0;
    }
  }
  return out;
}

function buildWalkableMask(wallMask: Uint8Array, cols: number, rows: number): Uint8Array {
  const walkable = new Uint8Array(cols * rows);
  for (let i = 0; i < wallMask.length; i++) walkable[i] = wallMask[i] ? 0 : 1;
  return walkable;
}

type EdgeRun = { axis: 'v' | 'h'; fixed: number; start: number; end: number };

function collectEdgeRuns(walkable: Uint8Array, cols: number, rows: number): EdgeRun[] {
  const runs: EdgeRun[] = [];

  for (let x = 0; x <= cols; x++) {
    let y = 0;
    while (y < rows) {
      while (y < rows && !hasVerticalEdge(walkable, cols, rows, x, y)) y++;
      const y0 = y;
      while (y < rows && hasVerticalEdge(walkable, cols, rows, x, y)) y++;
      if (y > y0) runs.push({ axis: 'v', fixed: x, start: y0, end: y });
    }
  }

  for (let y = 0; y <= rows; y++) {
    let x = 0;
    while (x < cols) {
      while (x < cols && !hasHorizontalEdge(walkable, cols, rows, x, y)) x++;
      const x0 = x;
      while (x < cols && hasHorizontalEdge(walkable, cols, rows, x, y)) x++;
      if (x > x0) runs.push({ axis: 'h', fixed: y, start: x0, end: x });
    }
  }

  return runs;
}

function hasVerticalEdge(walkable: Uint8Array, cols: number, rows: number, x: number, y: number): boolean {
  if (y < 0 || y >= rows) return false;
  const left = x > 0 ? walkable[y * cols + (x - 1)] : 0;
  const right = x < cols ? walkable[y * cols + x] : 0;
  if (x === 0) return right === 0;
  if (x === cols) return left === 0;
  return left !== right;
}

function hasHorizontalEdge(walkable: Uint8Array, cols: number, rows: number, x: number, y: number): boolean {
  if (x < 0 || x >= cols) return false;
  const up = y > 0 ? walkable[(y - 1) * cols + x] : 0;
  const down = y < rows ? walkable[y * cols + x] : 0;
  if (y === 0) return down === 0;
  if (y === rows) return up === 0;
  return up !== down;
}

function detectDoorsFromRuns(
  runs: EdgeRun[],
  walkable: Uint8Array,
  cols: number,
  rows: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
): ScannedDoor[] {
  const doors: ScannedDoor[] = [];
  const gs = map.gridSize;
  const ox = map.x + map.gridOffsetX;
  const oz = map.y + map.gridOffsetY;
  const byKey = new Map<string, EdgeRun[]>();

  for (const run of runs) {
    const key = `${run.axis}:${run.fixed}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(run);
  }

  for (const [key, group] of byKey) {
    group.sort((a, b) => a.start - b.start);
    const [axis, fixedStr] = key.split(':');
    const fixed = Number(fixedStr);

    for (let i = 0; i < group.length - 1; i++) {
      const a = group[i]!;
      const b = group[i + 1]!;
      const gap = b.start - a.end;
      if (gap < 1 || gap > 3) continue;

      const mid = (a.end + b.start) / 2;
      let floorBridge = true;

      if (axis === 'v') {
        const xL = fixed - 1;
        const xR = fixed;
        for (let gy = a.end; gy < b.start && floorBridge; gy++) {
          if (gy < 0 || gy >= rows) {
            floorBridge = false;
            break;
          }
          const leftOk = xL >= 0 && walkable[gy * cols + xL] === 1;
          const rightOk = xR < cols && walkable[gy * cols + xR] === 1;
          if (!leftOk || !rightOk) floorBridge = false;
        }
        if (!floorBridge) continue;
        doors.push({
          id: `door-${doors.length}`,
          cx: ox + fixed * gs,
          cz: oz + mid * gs,
          widthCells: gap,
          rotation: Math.PI / 2,
        });
      } else {
        const yU = fixed - 1;
        const yD = fixed;
        for (let gx = a.end; gx < b.start && floorBridge; gx++) {
          if (gx < 0 || gx >= cols) {
            floorBridge = false;
            break;
          }
          const upOk = yU >= 0 && walkable[yU * cols + gx] === 1;
          const downOk = yD < rows && walkable[yD * cols + gx] === 1;
          if (!upOk || !downOk) floorBridge = false;
        }
        if (!floorBridge) continue;
        doors.push({
          id: `door-${doors.length}`,
          cx: ox + mid * gs,
          cz: oz + fixed * gs,
          widthCells: gap,
          rotation: 0,
        });
      }
    }
  }

  return doors;
}

export function extractWallSegmentsFromWalkable(
  walkable: Uint8Array,
  cols: number,
  rows: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
): { segments: ScannedWallSegment[]; doors: ScannedDoor[] } {
  const gs = map.gridSize;
  const ox = map.x + map.gridOffsetX;
  const oz = map.y + map.gridOffsetY;
  const wallThickness = gs * 0.14;
  const runs = collectEdgeRuns(walkable, cols, rows);
  const doors = detectDoorsFromRuns(runs, walkable, cols, rows, map);
  const segments: ScannedWallSegment[] = [];

  for (const run of runs) {
    const len = run.end - run.start;
    if (len < 1) continue;

    if (run.axis === 'v') {
      segments.push({
        id: `wv-${segments.length}`,
        cx: ox + run.fixed * gs,
        cz: oz + (run.start + len / 2) * gs,
        length: len * gs,
        thickness: wallThickness,
        rotation: Math.PI / 2,
      });
    } else {
      segments.push({
        id: `wh-${segments.length}`,
        cx: ox + (run.start + len / 2) * gs,
        cz: oz + run.fixed * gs,
        length: len * gs,
        thickness: wallThickness,
        rotation: 0,
      });
    }
  }

  return { segments, doors };
}

/** Legacy — kept for tests; prefer extractWallSegmentsFromWalkable. */
export function extractWallSegments(
  wallCells: Uint8Array,
  cols: number,
  rows: number,
  map: Pick<MapItem, 'x' | 'y' | 'gridOffsetX' | 'gridOffsetY' | 'gridSize'>,
): ScannedWallSegment[] {
  const walkable = buildWalkableMask(wallCells, cols, rows);
  return extractWallSegmentsFromWalkable(walkable, cols, rows, map).segments;
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

  let wallMask = new Uint8Array(cols * rows);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.min(sampleW - 1, Math.max(0, scaledOffsetX + cx * scaledGrid));
      const y0 = Math.min(sampleH - 1, Math.max(0, scaledOffsetY + cy * scaledGrid));
      const stats = sampleCellStats(
        data,
        sampleW,
        sampleH,
        x0,
        y0,
        Math.min(sampleW, x0 + scaledGrid),
        Math.min(sampleH, y0 + scaledGrid),
        opts.darkPixelLum,
      );
      if (stats && isWall(stats, opts)) wallMask[cy * cols + cx] = 1;
    }
  }

  wallMask = new Uint8Array(morphClose(wallMask, cols, rows));
  wallMask = new Uint8Array(morphOpen(wallMask, cols, rows));
  wallMask = new Uint8Array(removeEnclosedVoids(wallMask, cols, rows));

  const walkable = buildWalkableMask(wallMask, cols, rows);
  const { segments: wallSegments, doors } = extractWallSegmentsFromWalkable(walkable, cols, rows, map);

  let wallCellCount = 0;
  for (let i = 0; i < wallMask.length; i++) if (wallMask[i]) wallCellCount++;

  return {
    cols,
    rows,
    wallCells: wallMask,
    wallSegments,
    doors,
    wallCellCount,
    props: [],
    waters: [],
    stairs: [],
    pits: [],
    featureCount: wallSegments.length + doors.length,
  };
}

export function sceneScanCacheKey(
  map: Pick<MapItem, 'id' | 'backgroundUrl' | 'width' | 'height' | 'gridSize' | 'gridOffsetX' | 'gridOffsetY'>,
  threshold: number,
): string {
  return `scene|walls-v5|${map.id}|${map.backgroundUrl ?? ''}|${map.width}x${map.height}|${map.gridSize}|${map.gridOffsetX},${map.gridOffsetY}|t${threshold}`;
}
