import * as THREE from 'three';
import {
  type MapSurfaceStyle,
  type MapSurfaceStyleId,
  resolveMapSurfaceStyle,
} from './mapSurfaceStyles';

const TEX_SIZE = 512;
const cache = new Map<string, THREE.CanvasTexture>();

function hash2(x: number, y: number, salt = 0): number {
  let n = Math.imul(x + salt * 13, 374761393) ^ Math.imul(y + 17, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function shade(
  rgb: [number, number, number],
  amount: number,
): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] + amount)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] + amount * 0.92)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] + amount * 0.85)));
  return `rgb(${r},${g},${b})`;
}

function fillNoise(
  ctx: CanvasRenderingContext2D,
  base: [number, number, number],
  amp: number,
  salt: number,
): void {
  const img = ctx.createImageData(TEX_SIZE, TEX_SIZE);
  const d = img.data;
  for (let y = 0; y < TEX_SIZE; y++) {
    for (let x = 0; x < TEX_SIZE; x++) {
      const n =
        (hash2(x >> 1, y >> 1, salt) * 0.45
          + hash2(x >> 3, y >> 3, salt + 3) * 0.35
          + hash2(x >> 5, y >> 5, salt + 7) * 0.2)
        - 0.5;
      const i = (y * TEX_SIZE + x) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] + n * amp));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + n * amp * 0.9));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + n * amp * 0.8));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawMortarGrid(
  ctx: CanvasRenderingContext2D,
  mortar: string,
  cellW: number,
  cellH: number,
  stagger: boolean,
  lineW: number,
): void {
  ctx.strokeStyle = mortar;
  ctx.lineWidth = lineW;
  for (let y = 0; y <= TEX_SIZE; y += cellH) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(TEX_SIZE, y + 0.5);
    ctx.stroke();
  }
  for (let row = 0; row * cellH < TEX_SIZE; row++) {
    const off = stagger && row % 2 ? cellW * 0.5 : 0;
    for (let x = -cellW; x <= TEX_SIZE + cellW; x += cellW) {
      ctx.beginPath();
      ctx.moveTo(x + off + 0.5, row * cellH);
      ctx.lineTo(x + off + 0.5, row * cellH + cellH);
      ctx.stroke();
    }
  }
}

function chipEdges(
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  stagger: boolean,
  color: string,
): void {
  ctx.fillStyle = color;
  for (let row = 0; row * cellH < TEX_SIZE; row++) {
    const off = stagger && row % 2 ? cellW * 0.5 : 0;
    for (let col = -1; col * cellW < TEX_SIZE + cellW; col++) {
      const x0 = col * cellW + off;
      const y0 = row * cellH;
      for (let k = 0; k < 3; k++) {
        const hx = x0 + hash2(col, row, 20 + k) * cellW;
        const hy = y0 + hash2(col, row, 40 + k) * cellH;
        const r = 1.5 + hash2(col, row, 60 + k) * 3;
        ctx.beginPath();
        ctx.arc(hx, hy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function paintFloorTile(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const base = parseHex(style.floor);
  const rough = parseHex(style.floorRough);
  const mortar = shade(rough, -28);
  fillNoise(ctx, base, 38, 1);

  switch (style.id) {
    case 'crypt':
      drawMortarGrid(ctx, mortar, 128, 128, false, 5);
      chipEdges(ctx, 128, 128, false, shade(rough, -18));
      // Niche stains
      for (let i = 0; i < 18; i++) {
        const x = hash2(i, 2, 9) * TEX_SIZE;
        const y = hash2(i, 3, 11) * TEX_SIZE;
        const g = ctx.createRadialGradient(x, y, 2, x, y, 28 + hash2(i, 4, 12) * 40);
        g.addColorStop(0, 'rgba(40,55,48,0.35)');
        g.addColorStop(1, 'rgba(40,55,48,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 60, y - 60, 120, 120);
      }
      break;
    case 'temple': {
      drawMortarGrid(ctx, mortar, 96, 96, false, 3);
      // Inset diamond accents
      ctx.strokeStyle = shade(base, 28);
      ctx.lineWidth = 2;
      for (let y = 48; y < TEX_SIZE; y += 96) {
        for (let x = 48; x < TEX_SIZE; x += 96) {
          ctx.beginPath();
          ctx.moveTo(x, y - 18);
          ctx.lineTo(x + 18, y);
          ctx.lineTo(x, y + 18);
          ctx.lineTo(x - 18, y);
          ctx.closePath();
          ctx.stroke();
        }
      }
      break;
    }
    case 'fortress':
      drawMortarGrid(ctx, mortar, 64, 32, true, 3);
      chipEdges(ctx, 64, 32, true, shade(rough, -12));
      break;
    case 'mine':
      fillNoise(ctx, rough, 48, 5);
      // Timber planks
      ctx.strokeStyle = shade(parseHex(style.wall), 10);
      ctx.lineWidth = 10;
      for (let y = 0; y < TEX_SIZE; y += 36) {
        ctx.beginPath();
        ctx.moveTo(0, y + 8);
        ctx.lineTo(TEX_SIZE, y + 8 + (hash2(y, 1, 2) - 0.5) * 4);
        ctx.stroke();
        ctx.strokeStyle = shade(parseHex(style.wallDark), 0);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(0, y + 14);
        ctx.lineTo(TEX_SIZE, y + 14);
        ctx.stroke();
        ctx.strokeStyle = shade(parseHex(style.wall), 10);
        ctx.lineWidth = 10;
      }
      break;
    case 'ruin':
      drawMortarGrid(ctx, mortar, 110, 72, true, 4);
      chipEdges(ctx, 110, 72, true, shade(rough, -22));
      // Rubble patches
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = shade(rough, (hash2(i, 1, 3) - 0.5) * 40);
        const x = hash2(i, 5, 6) * TEX_SIZE;
        const y = hash2(i, 7, 8) * TEX_SIZE;
        ctx.fillRect(x, y, 4 + hash2(i, 9, 1) * 14, 3 + hash2(i, 10, 2) * 10);
      }
      break;
    case 'clay':
      drawMortarGrid(ctx, mortar, 80, 80, false, 2);
      break;
    case 'mixed':
    default:
      drawMortarGrid(ctx, mortar, 96, 64, true, 4);
      chipEdges(ctx, 96, 64, true, shade(rough, -16));
      break;
  }

  // Fine grit overlay
  const grit = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 0; i < grit.data.length; i += 4) {
    if (hash2(i, 0, 99) > 0.97) {
      const v = hash2(i, 1, 98) > 0.5 ? 30 : -25;
      grit.data[i] = Math.max(0, Math.min(255, grit.data[i]! + v));
      grit.data[i + 1] = Math.max(0, Math.min(255, grit.data[i + 1]! + v));
      grit.data[i + 2] = Math.max(0, Math.min(255, grit.data[i + 2]! + v));
    }
  }
  ctx.putImageData(grit, 0, 0);
}

function paintWallTile(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const base = parseHex(style.wall);
  const dark = parseHex(style.wallDark);
  const mortar = shade(dark, -10);
  fillNoise(ctx, base, 32, 2);

  switch (style.id) {
    case 'crypt':
      drawMortarGrid(ctx, mortar, 160, 72, true, 5);
      // Niche rectangles
      ctx.strokeStyle = shade(dark, 8);
      ctx.lineWidth = 3;
      for (let y = 20; y < TEX_SIZE; y += 144) {
        for (let x = 24; x < TEX_SIZE; x += 160) {
          ctx.strokeRect(x, y, 48, 36);
          ctx.fillStyle = 'rgba(20,28,24,0.35)';
          ctx.fillRect(x + 2, y + 2, 44, 32);
        }
      }
      break;
    case 'temple':
      drawMortarGrid(ctx, mortar, 128, 64, false, 3);
      ctx.strokeStyle = shade(base, 35);
      ctx.lineWidth = 2;
      for (let y = 16; y < TEX_SIZE; y += 128) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(TEX_SIZE, y);
        ctx.stroke();
      }
      break;
    case 'fortress':
      drawMortarGrid(ctx, mortar, 96, 48, true, 4);
      break;
    case 'mine':
      fillNoise(ctx, dark, 40, 8);
      ctx.strokeStyle = shade(base, 15);
      ctx.lineWidth = 14;
      for (let x = 40; x < TEX_SIZE; x += 96) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + (hash2(x, 1, 2) - 0.5) * 8, TEX_SIZE);
        ctx.stroke();
      }
      break;
    case 'ruin':
      drawMortarGrid(ctx, mortar, 100, 56, true, 5);
      for (let i = 0; i < 25; i++) {
        ctx.fillStyle = shade(dark, hash2(i, 2, 3) * 20);
        ctx.beginPath();
        ctx.ellipse(
          hash2(i, 4, 5) * TEX_SIZE,
          hash2(i, 6, 7) * TEX_SIZE,
          8 + hash2(i, 8, 9) * 20,
          5 + hash2(i, 10, 11) * 12,
          hash2(i, 12, 13) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    case 'clay':
      drawMortarGrid(ctx, mortar, 72, 40, true, 2);
      break;
    case 'mixed':
    default:
      drawMortarGrid(ctx, mortar, 112, 56, true, 4);
      break;
  }

  // Vertical wear streaks
  for (let i = 0; i < 12; i++) {
    const x = hash2(i, 1, 14) * TEX_SIZE;
    const g = ctx.createLinearGradient(x, 0, x, TEX_SIZE);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.4, `rgba(0,0,0,${0.08 + hash2(i, 2, 15) * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 6, 0, 12, TEX_SIZE);
  }
}

function buildCanvasTexture(
  styleId: MapSurfaceStyleId,
  kind: 'floor' | 'wall',
): THREE.CanvasTexture {
  const key = `${styleId}:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = TEX_SIZE;
  canvas.height = TEX_SIZE;
  const ctx = canvas.getContext('2d')!;
  const style = resolveMapSurfaceStyle(styleId);
  if (kind === 'floor') paintFloorTile(ctx, style);
  else paintWallTile(ctx, style);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Detailed repeating surface art. `default` / `map` → null (use map image / flat). */
export function getMapSurfaceTexture(
  styleId: string | undefined | null,
  kind: 'floor' | 'wall',
): THREE.CanvasTexture | null {
  if (!styleId || styleId === 'default' || styleId === 'map') return null;
  const style = resolveMapSurfaceStyle(styleId);
  return buildCanvasTexture(style.id, kind);
}

/** Clone + set tile repeat for a mesh of given world size (map units). */
export function tileSurfaceTexture(
  base: THREE.CanvasTexture,
  worldW: number,
  worldH: number,
  tileWorld = 96,
): THREE.CanvasTexture {
  const t = base.clone();
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(Math.max(1, worldW / tileWorld), Math.max(1, worldH / tileWorld));
  t.needsUpdate = true;
  return t;
}

export function usesArtFloor(styleId: string | undefined | null): boolean {
  return Boolean(styleId && styleId !== 'default' && styleId !== 'map');
}
