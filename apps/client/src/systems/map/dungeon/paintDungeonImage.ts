import type { DoorKind, DungeonMotif, DungeonStair, GeneratedDungeon } from './generateDungeon';

interface StonePalette {
  earth: string;
  floor: [number, number, number];
  rough: [number, number, number];
  mortar: string;
  lit: string;
  mid: string;
  shade: string;
  wood: string;
  woodDark: string;
}

const STONE: Record<DungeonMotif, StonePalette> = {
  mixed: { earth: '#14110e', floor: [168, 154, 132], rough: [132, 118, 98], mortar: 'rgba(42,34,26,0.55)', lit: '#8d8478', mid: '#5a534b', shade: '#2c2823', wood: '#6d4a30', woodDark: '#3d2918' },
  crypt: { earth: '#101311', floor: [138, 146, 138], rough: [108, 116, 110], mortar: 'rgba(28,36,32,0.55)', lit: '#7e8a84', mid: '#4c5652', shade: '#232826', wood: '#5c4636', woodDark: '#2e241c' },
  temple: { earth: '#16130e', floor: [188, 176, 150], rough: [154, 140, 116], mortar: 'rgba(62,52,36,0.5)', lit: '#a39884', mid: '#6a604e', shade: '#332e24', wood: '#7a5434', woodDark: '#463018' },
  fortress: { earth: '#121214', floor: [150, 150, 146], rough: [118, 118, 114], mortar: 'rgba(32,32,34,0.55)', lit: '#8a8a86', mid: '#555554', shade: '#2a2a2c', wood: '#644832', woodDark: '#342418' },
  mine: { earth: '#100e0c', floor: [118, 108, 96], rough: [96, 86, 74], mortar: 'rgba(24,20,16,0.6)', lit: '#6e665c', mid: '#433e38', shade: '#221e1a', wood: '#5a4030', woodDark: '#2c1e14' },
  ruin: { earth: '#16100c', floor: [164, 136, 108], rough: [132, 104, 78], mortar: 'rgba(52,36,24,0.55)', lit: '#8a7460', mid: '#5c4a3a', shade: '#2e241c', wood: '#6a4630', woodDark: '#3a2418' },
};

export interface DungeonPaintJob {
  cols: number;
  rows: number;
  cell: number;
  motif: DungeonMotif;
  floor: Uint8Array;
  roomOf: Int16Array;
  doors: Array<[string, DoorKind]>;
  stairs: DungeonStair[];
  rooms: Array<{ id: number; x: number; y: number; w: number; h: number }>;
}

function hash(x: number, y: number, salt = 0): number {
  let n = Math.imul(x + salt * 13, 374761393) ^ Math.imul(y + 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function rgb(base: [number, number, number], jitter: number): string {
  const r = Math.max(0, Math.min(255, Math.round(base[0] + jitter)));
  const g = Math.max(0, Math.min(255, Math.round(base[1] + jitter * 0.86)));
  const b = Math.max(0, Math.min(255, Math.round(base[2] + jitter * 0.62)));
  return `rgb(${r}, ${g}, ${b})`;
}

function makeCanvas(width: number, height: number): OffscreenCanvas {
  return new OffscreenCanvas(Math.max(1, Math.ceil(width)), Math.max(1, Math.ceil(height)));
}

function ctx2d(canvas: OffscreenCanvas, opaque = false): OffscreenCanvasRenderingContext2D | null {
  return canvas.getContext('2d', opaque ? { alpha: false } : undefined);
}

export function dungeonToPaintJob(dungeon: GeneratedDungeon): DungeonPaintJob {
  return {
    cols: dungeon.cols,
    rows: dungeon.rows,
    cell: dungeon.cell,
    motif: dungeon.motif,
    floor: dungeon.floor,
    roomOf: dungeon.roomOf,
    doors: [...dungeon.doors.entries()],
    stairs: dungeon.stairs,
    rooms: dungeon.rooms.map((room) => ({ id: room.id, x: room.x, y: room.y, w: room.w, h: room.h })),
  };
}

export async function paintDungeonBlob(job: DungeonPaintJob): Promise<Blob> {
  const canvas = paintDungeonCanvas(job);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  if (!blob) throw new Error('Could not encode dungeon map');
  return blob;
}

function paintDungeonCanvas(job: DungeonPaintJob): OffscreenCanvas {
  const { cols, rows, cell, floor, roomOf } = job;
  const palette = STONE[job.motif] ?? STONE.mixed;
  const doors = new Map(job.doors);
  const paintCell = Math.max(16, Math.round(cell / 2));
  const canvas = makeCanvas(cols * paintCell, rows * paintCell);
  const ctx = ctx2d(canvas, true);
  if (!ctx) throw new Error('Could not paint dungeon map');

  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && floor[y * cols + x] === 1;

  const rock = rockTile(palette);
  const pattern = ctx.createPattern(rock, 'repeat');
  ctx.fillStyle = pattern ?? palette.earth;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isFloor(x, y)) continue;
      const dressed = (roomOf[y * cols + x] ?? 0) > 0;
      const tone = (hash(x, y) - 0.5) * (dressed ? 22 : 30);
      const px = x * paintCell;
      const py = y * paintCell;
      const grout = dressed ? 2 : 1;
      const top = dressed && isFloor(x, y - 1) && hash(x, y, 6) > 0.42 ? 0 : grout;
      const left = dressed && isFloor(x - 1, y) && hash(x, y, 7) > 0.42 ? 0 : grout;
      ctx.fillStyle = palette.mortar;
      ctx.fillRect(px, py, paintCell, paintCell);
      ctx.fillStyle = rgb(dressed ? palette.floor : palette.rough, tone);
      ctx.fillRect(px + left, py + top, paintCell - left - grout, paintCell - top - grout);
    }
  }

  const shadeDepth = Math.max(2, Math.round(paintCell * 0.16));
  const shadeNorth = shadeStamp(paintCell, shadeDepth, true, true);
  const shadeSouth = shadeStamp(paintCell, shadeDepth, true, false);
  const shadeWest = shadeStamp(paintCell, shadeDepth, false, true);
  const shadeEast = shadeStamp(paintCell, shadeDepth, false, false);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isFloor(x, y)) continue;
      const px = x * paintCell;
      const py = y * paintCell;
      if (!isFloor(x, y - 1)) ctx.drawImage(shadeNorth, px, py);
      if (!isFloor(x + 1, y)) ctx.drawImage(shadeEast, px + paintCell - shadeDepth, py);
      if (!isFloor(x, y + 1)) ctx.drawImage(shadeSouth, px, py + paintCell - shadeDepth);
      if (!isFloor(x - 1, y)) ctx.drawImage(shadeWest, px, py);
    }
  }

  const lip = Math.max(6, Math.round(paintCell * 0.34));
  const horizontalLip = barStamp(paintCell, lip, true, palette);
  const verticalLip = barStamp(lip, paintCell, false, palette);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isFloor(x, y)) continue;
      const px = x * paintCell;
      const py = y * paintCell;
      const north = !isFloor(x, y - 1);
      const east = !isFloor(x + 1, y);
      const south = !isFloor(x, y + 1);
      const west = !isFloor(x - 1, y);
      if (north) ctx.drawImage(horizontalLip, px, py - lip);
      if (east) ctx.drawImage(verticalLip, px + paintCell, py);
      if (south) ctx.drawImage(horizontalLip, px, py + paintCell);
      if (west) ctx.drawImage(verticalLip, px - lip, py);
      if (north && west) fillCorner(ctx, px - lip, py - lip, lip);
      if (north && east) fillCorner(ctx, px + paintCell, py - lip, lip);
      if (south && west) fillCorner(ctx, px - lip, py + paintCell, lip);
      if (south && east) fillCorner(ctx, px + paintCell, py + paintCell, lip);
    }
  }

  const thickness = Math.max(5, paintCell * 0.24);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isFloor(x, y)) continue;
      const east = doorAt(doors, x, y, x + 1, y);
      if (east) paintOpening(ctx, x, y, x + 1, y, east, paintCell, thickness, palette);
      const south = doorAt(doors, x, y, x, y + 1);
      if (south) paintOpening(ctx, x, y, x, y + 1, south, paintCell, thickness, palette);
    }
  }

  for (const stair of job.stairs) {
    const px = stair.x * paintCell;
    const py = stair.y * paintCell;
    const steps = 4;
    for (let i = 0; i < steps; i++) {
      const slot = stair.direction === 'down' ? i : steps - 1 - i;
      const y0 = py + (paintCell * slot) / steps;
      const h = paintCell / steps;
      ctx.fillStyle = rgb(palette.floor, -18 - slot * 6);
      ctx.fillRect(px + 2, y0, paintCell - 4, h);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(px + 2, y0 + h - 1, paintCell - 4, 1);
    }
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.max(11, Math.round(paintCell * 0.42))}px sans-serif`;
  for (const room of job.rooms) {
    if (room.w <= 1 || room.h <= 1) continue;
    const cx = (room.x + room.w / 2) * paintCell;
    const cy = (room.y + room.h / 2) * paintCell;
    ctx.fillStyle = 'rgba(28, 22, 16, 0.42)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, paintCell * 0.34, paintCell * 0.24, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f4ecdc';
    ctx.fillText(String(room.id), cx, cy + 1);
  }

  return canvas;
}

function doorAt(doors: Map<string, DoorKind>, x: number, y: number, nx: number, ny: number): DoorKind | undefined {
  const key = nx > x || (nx === x && ny > y)
    ? `${x},${y},${nx > x ? 'e' : 's'}`
    : `${nx},${ny},${x > nx ? 'e' : 's'}`;
  return doors.get(key);
}

function rockTile(palette: StonePalette): OffscreenCanvas {
  const tile = makeCanvas(96, 96);
  const g = ctx2d(tile);
  if (!g) return tile;
  g.fillStyle = palette.earth;
  g.fillRect(0, 0, 96, 96);
  for (let i = 0; i < 8; i++) {
    g.fillStyle = rgb(palette.rough, (hash(i, 4) - 0.5) * 28 - 6);
    g.fillRect(hash(i, 1) * 80, hash(i, 2) * 80, 28, 22);
  }
  return tile;
}

function shadeStamp(length: number, depth: number, vertical: boolean, fromStart: boolean): OffscreenCanvas {
  const stamp = makeCanvas(vertical ? length : depth, vertical ? depth : length);
  const g = ctx2d(stamp);
  if (!g) return stamp;
  const gradient = vertical
    ? g.createLinearGradient(0, fromStart ? 0 : depth, 0, fromStart ? depth : 0)
    : g.createLinearGradient(fromStart ? 0 : depth, 0, fromStart ? depth : 0, 0);
  gradient.addColorStop(0, 'rgba(0,0,0,0.38)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gradient;
  g.fillRect(0, 0, stamp.width, stamp.height);
  return stamp;
}

function barStamp(w: number, h: number, alongX: boolean, palette: StonePalette): OffscreenCanvas {
  const stamp = makeCanvas(w, h);
  const g = ctx2d(stamp);
  if (!g) return stamp;
  const gradient = g.createLinearGradient(0, 0, alongX ? 0 : w, alongX ? h : 0);
  gradient.addColorStop(0, palette.lit);
  gradient.addColorStop(0.38, palette.mid);
  gradient.addColorStop(1, palette.shade);
  g.fillStyle = gradient;
  g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,248,230,0.28)';
  if (alongX) g.fillRect(0, 0, w, Math.max(1, h * 0.2));
  else g.fillRect(0, 0, Math.max(1, w * 0.2), h);
  return stamp;
}

function fillCorner(ctx: OffscreenCanvasRenderingContext2D, x: number, y: number, lip: number): void {
  ctx.fillStyle = '#5a534b';
  ctx.fillRect(x, y, lip, lip);
}

function paintOpening(
  ctx: OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  nx: number,
  ny: number,
  kind: DoorKind,
  paintCell: number,
  thickness: number,
  palette: StonePalette,
): void {
  const alongX = ny !== y;
  const barX = alongX ? x * paintCell : (x + 1) * paintCell - thickness / 2;
  const barY = alongX ? (y + 1) * paintCell - thickness / 2 : y * paintCell;
  const barW = alongX ? paintCell : thickness;
  const barH = alongX ? thickness : paintCell;
  ctx.fillStyle = palette.mid;
  ctx.fillRect(barX, barY, barW, barH);
  if (kind === 'secret') return;
  if (kind === 'open') {
    ctx.fillStyle = palette.shade;
    const jamb = Math.max(2, paintCell * 0.16);
    if (alongX) {
      ctx.fillRect(barX, barY, jamb, barH);
      ctx.fillRect(barX + paintCell - jamb, barY, jamb, barH);
    } else {
      ctx.fillRect(barX, barY, barW, jamb);
      ctx.fillRect(barX, barY + paintCell - jamb, barW, jamb);
    }
    return;
  }
  const inset = paintCell * 0.14;
  ctx.fillStyle = palette.wood;
  if (alongX) ctx.fillRect(barX + inset, barY + 1, paintCell - inset * 2, Math.max(2, barH - 2));
  else ctx.fillRect(barX + 1, barY + inset, Math.max(2, barW - 2), paintCell - inset * 2);
  if (kind === 'locked') {
    ctx.fillStyle = '#8a9098';
    if (alongX) ctx.fillRect(barX + barW * 0.72, barY, 3, barH);
    else ctx.fillRect(barX, barY + barH * 0.72, barW, 3);
  }
}

let painter: Worker | null = null;
let painting = false;
const paintQueue: Array<{ job: DungeonPaintJob; resolve: (url: string) => void; reject: (error: Error) => void }> = [];

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Could not read dungeon image'));
    reader.readAsDataURL(blob);
  });
}

function ensurePainter(): Worker {
  if (painter) return painter;
  painter = new Worker(new URL('./dungeonPaint.worker.ts', import.meta.url), { type: 'module' });
  painter.onmessage = (event: MessageEvent<{ ok: boolean; blob?: Blob; error?: string }>) => {
    const next = paintQueue.shift();
    painting = false;
    if (!next) return;
    if (!event.data.ok || !event.data.blob) next.reject(new Error(event.data.error ?? 'paint failed'));
    else void blobToDataUrl(event.data.blob).then(next.resolve, next.reject);
    pumpPainter();
  };
  painter.onerror = () => {
    const next = paintQueue.shift();
    painting = false;
    next?.reject(new Error('Dungeon painter failed'));
    pumpPainter();
  };
  return painter;
}

function pumpPainter(): void {
  if (painting || paintQueue.length === 0) return;
  const next = paintQueue[0];
  if (!next) return;
  painting = true;
  ensurePainter().postMessage(next.job);
}

/** Paint off the page thread so the table stays responsive. */
export function paintDungeonOffThread(dungeon: GeneratedDungeon): Promise<string> {
  const job = dungeonToPaintJob(dungeon);
  return new Promise((resolve, reject) => {
    paintQueue.push({ job, resolve, reject });
    pumpPainter();
  });
}
