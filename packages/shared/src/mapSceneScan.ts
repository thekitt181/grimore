export type MapScanInput = {
  width: number;
  height: number;
  gridSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
  x: number;
  y: number;
};

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
  threshold: 64,
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

/** Parchment margin outside the dungeon â€” not walkable floor. */
function isParchment(stats: CellStats): boolean {
  return stats.lum > 158 && stats.darkRatio < 0.22 && stats.r > stats.b + 4 && stats.g > stats.b;
}

/** Tan door swatches break wall lines but are walkable. */
function isDoorTone(stats: CellStats): boolean {
  return stats.r > 130 && stats.g > 105 && stats.b > 65 && stats.lum > 95 && stats.lum < 205 && stats.darkRatio < 0.38;
}

/** Strict wall test â€” only thick dark map borders, not furniture or lighting. */
function isWall(stats: CellStats, opts: Required<MapSceneScanOptions>): boolean {
  if (isAmbientGlow(stats) || isWater(stats) || isWoodTone(stats) || isParchment(stats) || isDoorTone(stats)) return false;
  if (stats.lum < 42 && stats.darkRatio >= 0.35) return true;
  if (stats.lum < opts.threshold && stats.darkRatio >= opts.darkRatio) return true;
  return false;
}

/** Remove lone wall speckles without eroding thin wall lines. */
function removeIsolatedWallCells(wallMask: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = Uint8Array.from(wallMask);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const idx = y * cols + x;
      if (!wallMask[idx]) continue;
      let neighbors = 0;
      if (x > 0 && wallMask[idx - 1]) neighbors++;
      if (x < cols - 1 && wallMask[idx + 1]) neighbors++;
      if (y > 0 && wallMask[idx - cols]) neighbors++;
      if (y < rows - 1 && wallMask[idx + cols]) neighbors++;
      if (neighbors === 0) out[idx] = 0;
    }
  }
  return out;
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

function buildWalkableMask(
  wallMask: Uint8Array,
  statsGrid: (CellStats | null)[],
  cols: number,
  rows: number,
): Uint8Array {
  const raw = new Uint8Array(cols * rows);
  for (let i = 0; i < wallMask.length; i++) {
    if (wallMask[i]) continue;
    const st = statsGrid[i];
    if (st && isParchment(st)) continue;
    raw[i] = 1;
  }
  return keepInteriorWalkable(raw, cols, rows);
}

/** Drop exterior parchment â€” keep only floor reachable from map center. */
function keepInteriorWalkable(walkable: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(cols * rows);
  const visited = new Uint8Array(cols * rows);
  const sx = Math.floor(cols / 2);
  const sy = Math.floor(rows / 2);
  let start = -1;

  for (let r = 0; r <= Math.max(cols, rows) && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
        const idx = y * cols + x;
        if (walkable[idx]) {
          start = idx;
          break;
        }
      }
    }
  }
  if (start < 0) return walkable;

  const stack = [start];
  while (stack.length > 0) {
    const idx = stack.pop()!;
    if (visited[idx] || !walkable[idx]) continue;
    visited[idx] = 1;
    out[idx] = 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) stack.push(idx - 1);
    if (x < cols - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - cols);
    if (y < rows - 1) stack.push(idx + cols);
  }
  return out;
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
  map: MapScanInput,
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
  map: MapScanInput,
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

/** Legacy â€” kept for tests; prefer extractWallSegmentsFromWalkable. */
export function extractWallSegments(
  wallCells: Uint8Array,
  cols: number,
  rows: number,
  map: MapScanInput,
): ScannedWallSegment[] {
  const walkable = buildWalkableMask(wallCells, new Array(cols * rows).fill(null), cols, rows);
  return extractWallSegmentsFromWalkable(walkable, cols, rows, map).segments;
}

export function scanMapImageFromPixelData(
  map: MapScanInput,
  data: Uint8ClampedArray,
  sampleW: number,
  sampleH: number,
  options?: MapSceneScanOptions,
): MapSceneScanResult {
  const opts = { ...DEFAULTS, ...options };
  const gridSize = Math.max(4, map.gridSize);
  const cols = Math.ceil(map.width / gridSize);
  const rows = Math.ceil(map.height / gridSize);
  const maxDim = 2800;
  const scale = Math.min(1, maxDim / Math.max(map.width, map.height));
  const scaledGrid = Math.max(4, Math.round(gridSize * scale));
  const scaledOffsetX = Math.round(map.gridOffsetX * scale);
  const scaledOffsetY = Math.round(map.gridOffsetY * scale);

  const statsGrid: (CellStats | null)[] = new Array(cols * rows).fill(null);
  let wallMask = new Uint8Array(cols * rows);

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const idx = cy * cols + cx;
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
      if (!stats) continue;
      statsGrid[idx] = stats;
      if (isWall(stats, opts)) wallMask[idx] = 1;
    }
  }

  wallMask = new Uint8Array(removeIsolatedWallCells(wallMask, cols, rows));
  wallMask = new Uint8Array(removeEnclosedVoids(wallMask, cols, rows));

  const walkable = buildWalkableMask(wallMask, statsGrid, cols, rows);
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
  map: MapScanInput & { id?: string; backgroundUrl?: string | null },
  threshold: number,
  method: 'cubicasa' | 'cv' = 'cubicasa',
): string {
  return `scene|${method === 'cubicasa' ? 'cubicasa-v1' : 'walls-v6'}|${map.id ?? ''}|${map.backgroundUrl ?? ''}|${map.width}x${map.height}|${map.gridSize}|${map.gridOffsetX},${map.gridOffsetY}|t${threshold}`;
}

/** Build extrusion segments from a CubiCasa-style walkable grid (server segmentation). */
export function buildSceneFromWalkableGrid(
  map: MapScanInput,
  cols: number,
  rows: number,
  walkableFlat: ArrayLike<number>,
): MapSceneScanResult {
  const raw = new Uint8Array(cols * rows);
  for (let i = 0; i < raw.length; i++) raw[i] = walkableFlat[i] ? 1 : 0;
  const walkable = keepInteriorWalkable(raw, cols, rows);
  const { segments: wallSegments, doors } = extractWallSegmentsFromWalkable(walkable, cols, rows, map);

  let wallCellCount = 0;
  for (let i = 0; i < walkable.length; i++) if (!walkable[i]) wallCellCount++;

  return {
    cols,
    rows,
    wallCells: Uint8Array.from(walkable, (v) => (v ? 0 : 1)),
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
