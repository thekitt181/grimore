import * as THREE from 'three';
import {
  type MapSurfaceStyle,
  type MapSurfaceStyleId,
  resolveMapSurfaceStyle,
} from './mapSurfaceStyles';

/** High-res tileable surfaces (bump cache key when art changes). */
const TEX_SIZE = 1024;
const CACHE_TAG = 'hq4';

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

function shade(rgb: [number, number, number], amount: number): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] + amount)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] + amount * 0.92)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] + amount * 0.85)));
  return `rgb(${r},${g},${b})`;
}

function fbm(x: number, y: number, salt: number): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < 5; o++) {
    sum += amp * (hash2(Math.floor(x * freq), Math.floor(y * freq), salt + o) * 2 - 1);
    norm += amp;
    amp *= 0.52;
    freq *= 2.1;
  }
  return sum / norm;
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
        fbm(x * 0.02, y * 0.02, salt) * 0.55
        + fbm(x * 0.08, y * 0.08, salt + 11) * 0.3
        + (hash2(x, y, salt + 22) - 0.5) * 0.15;
      const i = (y * TEX_SIZE + x) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] + n * amp));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + n * amp * 0.92));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + n * amp * 0.86));
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

/** Per-block lighting so masonry reads as 3D stone, not flat paint. */
function shadeStoneBlocks(
  ctx: CanvasRenderingContext2D,
  cellW: number,
  cellH: number,
  stagger: boolean,
  base: [number, number, number],
  salt: number,
): void {
  for (let row = 0; row * cellH < TEX_SIZE; row++) {
    const off = stagger && row % 2 ? cellW * 0.5 : 0;
    for (let col = -1; col * cellW < TEX_SIZE + cellW; col++) {
      const x0 = Math.floor(col * cellW + off) + 2;
      const y0 = row * cellH + 2;
      const w = cellW - 4;
      const h = cellH - 4;
      if (w < 8 || h < 8) continue;
      const jitter = (hash2(col, row, salt) - 0.5) * 22;
      const tone: [number, number, number] = [
        Math.max(0, Math.min(255, base[0] + jitter)),
        Math.max(0, Math.min(255, base[1] + jitter * 0.92)),
        Math.max(0, Math.min(255, base[2] + jitter * 0.86)),
      ];
      const g = ctx.createLinearGradient(x0, y0, x0 + w, y0 + h);
      g.addColorStop(0, shade(tone, 14));
      g.addColorStop(0.45, shade(tone, 4));
      g.addColorStop(1, shade(tone, -16));
      ctx.fillStyle = g;
      ctx.fillRect(x0, y0, w, h);
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
      for (let k = 0; k < 4; k++) {
        const hx = x0 + hash2(col, row, 20 + k) * cellW;
        const hy = y0 + hash2(col, row, 40 + k) * cellH;
        const r = 1.5 + hash2(col, row, 60 + k) * 4;
        ctx.beginPath();
        ctx.arc(hx, hy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function paintFractureLines(
  ctx: CanvasRenderingContext2D,
  count: number,
  color: string,
  salt: number,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    let x = hash2(i, 1, salt) * TEX_SIZE;
    let y = hash2(i, 2, salt) * TEX_SIZE;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const segs = 4 + Math.floor(hash2(i, 3, salt) * 5);
    for (let s = 0; s < segs; s++) {
      x += (hash2(i, s, salt + 4) - 0.5) * 90;
      y += (hash2(i, s, salt + 8) - 0.5) * 90;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}

function paintOreFlecks(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const oreA = parseHex(style.floorRough);
  for (let i = 0; i < 120; i++) {
    const x = hash2(i, 5, 90) * TEX_SIZE;
    const y = hash2(i, 6, 91) * TEX_SIZE;
    const r = 1 + hash2(i, 7, 92) * 3.5;
    const gold = hash2(i, 8, 93) > 0.82;
    ctx.fillStyle = gold ? 'rgba(201,168,76,0.55)' : shade(oreA, 22 + (hash2(i, 9, 94) - 0.5) * 20);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paintMineFloor(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const base = parseHex(style.floor);
  const rough = parseHex(style.floorRough);
  fillNoise(ctx, base, 42, 31);
  shadeStoneBlocks(ctx, 88, 72, true, base, 32);
  drawMortarGrid(ctx, shade(rough, -32), 88, 72, true, 2.5);
  chipEdges(ctx, 88, 72, true, shade(rough, -14));
  paintFractureLines(ctx, 28, 'rgba(18,14,10,0.35)', 33);
  paintOreFlecks(ctx, style);
  for (let i = 0; i < 16; i++) {
    const x = hash2(i, 1, 40) * TEX_SIZE;
    const y = hash2(i, 2, 41) * TEX_SIZE;
    const g = ctx.createRadialGradient(x, y, 0, x, y, 40 + hash2(i, 3, 42) * 50);
    g.addColorStop(0, 'rgba(0,0,0,0.22)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 55, y - 55, 110, 110);
  }
}

function paintMineWall(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const base = parseHex(style.wall);
  const dark = parseHex(style.wallDark);
  fillNoise(ctx, base, 36, 41);
  shadeStoneBlocks(ctx, 96, 64, false, base, 42);
  drawMortarGrid(ctx, shade(dark, -8), 96, 64, false, 3);
  paintFractureLines(ctx, 36, 'rgba(12,10,8,0.45)', 43);
  paintOreFlecks(ctx, { ...style, floorRough: style.wallDark });
  // Occasional timber brace — not the whole wall
  ctx.fillStyle = shade(parseHex('#5a4030'), 6);
  for (let i = 0; i < 3; i++) {
    const y = 120 + i * 280 + hash2(i, 1, 44) * 40;
    const h = 18 + hash2(i, 2, 45) * 8;
    ctx.fillRect(0, y, TEX_SIZE, h);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, y + h - 2, TEX_SIZE, 2);
    ctx.fillStyle = shade(parseHex('#5a4030'), 6);
  }
  for (let i = 0; i < 20; i++) {
    const x = hash2(i, 3, 46) * TEX_SIZE;
    const g = ctx.createLinearGradient(x, 0, x, TEX_SIZE);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.35, `rgba(0,0,0,${0.06 + hash2(i, 4, 47) * 0.08})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 8, 0, 16, TEX_SIZE);
  }
}

function applyMicroGrit(ctx: CanvasRenderingContext2D): void {
  const grit = ctx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
  for (let i = 0; i < grit.data.length; i += 4) {
    const px = (i / 4) % TEX_SIZE;
    const py = Math.floor(i / 4 / TEX_SIZE);
    if (hash2(px, py, 99) > 0.965) {
      const v = hash2(px, py, 98) > 0.5 ? 22 : -18;
      grit.data[i] = Math.max(0, Math.min(255, grit.data[i]! + v));
      grit.data[i + 1] = Math.max(0, Math.min(255, grit.data[i + 1]! + v));
      grit.data[i + 2] = Math.max(0, Math.min(255, grit.data[i + 2]! + v));
    }
  }
  ctx.putImageData(grit, 0, 0);
}

function paintFloorTile(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const base = parseHex(style.floor);
  const rough = parseHex(style.floorRough);
  const mortar = shade(rough, -28);
  fillNoise(ctx, base, 40, 1);

  switch (style.id) {
    case 'crypt':
      shadeStoneBlocks(ctx, 128, 128, false, base, 2);
      drawMortarGrid(ctx, mortar, 128, 128, false, 4);
      chipEdges(ctx, 128, 128, false, shade(rough, -18));
      for (let i = 0; i < 22; i++) {
        const x = hash2(i, 2, 9) * TEX_SIZE;
        const y = hash2(i, 3, 11) * TEX_SIZE;
        const g = ctx.createRadialGradient(x, y, 2, x, y, 28 + hash2(i, 4, 12) * 44);
        g.addColorStop(0, 'rgba(40,55,48,0.38)');
        g.addColorStop(1, 'rgba(40,55,48,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x - 60, y - 60, 120, 120);
      }
      break;
    case 'temple': {
      shadeStoneBlocks(ctx, 96, 96, false, base, 3);
      drawMortarGrid(ctx, mortar, 96, 96, false, 2.5);
      ctx.strokeStyle = shade(base, 32);
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
      shadeStoneBlocks(ctx, 64, 32, true, base, 4);
      drawMortarGrid(ctx, mortar, 64, 32, true, 2.5);
      chipEdges(ctx, 64, 32, true, shade(rough, -12));
      break;
    case 'mine':
      paintMineFloor(ctx, style);
      break;
    case 'ruin':
      shadeStoneBlocks(ctx, 110, 72, true, base, 5);
      drawMortarGrid(ctx, mortar, 110, 72, true, 3.5);
      chipEdges(ctx, 110, 72, true, shade(rough, -22));
      for (let i = 0; i < 48; i++) {
        ctx.fillStyle = shade(rough, (hash2(i, 1, 3) - 0.5) * 40);
        const x = hash2(i, 5, 6) * TEX_SIZE;
        const y = hash2(i, 7, 8) * TEX_SIZE;
        ctx.fillRect(x, y, 4 + hash2(i, 9, 1) * 16, 3 + hash2(i, 10, 2) * 12);
      }
      break;
    case 'clay':
      shadeStoneBlocks(ctx, 80, 80, false, base, 6);
      drawMortarGrid(ctx, mortar, 80, 80, false, 2);
      break;
    case 'mixed':
    default:
      shadeStoneBlocks(ctx, 96, 64, true, base, 7);
      drawMortarGrid(ctx, mortar, 96, 64, true, 3);
      chipEdges(ctx, 96, 64, true, shade(rough, -16));
      break;
  }

  applyMicroGrit(ctx);
}

function paintWallTile(ctx: CanvasRenderingContext2D, style: MapSurfaceStyle): void {
  const base = parseHex(style.wall);
  const dark = parseHex(style.wallDark);
  const mortar = shade(dark, -10);
  fillNoise(ctx, base, 34, 2);

  switch (style.id) {
    case 'crypt':
      shadeStoneBlocks(ctx, 160, 72, true, base, 8);
      drawMortarGrid(ctx, mortar, 160, 72, true, 4);
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
      shadeStoneBlocks(ctx, 128, 64, false, base, 9);
      drawMortarGrid(ctx, mortar, 128, 64, false, 2.5);
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
      shadeStoneBlocks(ctx, 96, 48, true, base, 10);
      drawMortarGrid(ctx, mortar, 96, 48, true, 3.5);
      chipEdges(ctx, 96, 48, true, shade(dark, -10));
      break;
    case 'mine':
      paintMineWall(ctx, style);
      break;
    case 'ruin':
      shadeStoneBlocks(ctx, 100, 56, true, base, 11);
      drawMortarGrid(ctx, mortar, 100, 56, true, 4);
      for (let i = 0; i < 32; i++) {
        ctx.fillStyle = shade(dark, hash2(i, 2, 3) * 20);
        ctx.beginPath();
        ctx.ellipse(
          hash2(i, 4, 5) * TEX_SIZE,
          hash2(i, 6, 7) * TEX_SIZE,
          8 + hash2(i, 8, 9) * 22,
          5 + hash2(i, 10, 11) * 14,
          hash2(i, 12, 13) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      break;
    case 'clay':
      shadeStoneBlocks(ctx, 72, 40, true, base, 12);
      drawMortarGrid(ctx, mortar, 72, 40, true, 2);
      break;
    case 'mixed':
    default:
      shadeStoneBlocks(ctx, 112, 56, true, base, 13);
      drawMortarGrid(ctx, mortar, 112, 56, true, 3.5);
      chipEdges(ctx, 112, 56, true, shade(dark, -12));
      break;
  }

  for (let i = 0; i < 14; i++) {
    const x = hash2(i, 1, 14) * TEX_SIZE;
    const g = ctx.createLinearGradient(x, 0, x, TEX_SIZE);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.4, `rgba(0,0,0,${0.07 + hash2(i, 2, 15) * 0.1})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - 7, 0, 14, TEX_SIZE);
  }

  applyMicroGrit(ctx);
}

function buildCanvasTexture(
  styleId: MapSurfaceStyleId,
  kind: 'floor' | 'wall',
): THREE.CanvasTexture {
  const key = `${CACHE_TAG}:${styleId}:${kind}`;
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
  tex.anisotropy = 16;
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
  t.anisotropy = 16;
  t.repeat.set(Math.max(1, worldW / tileWorld), Math.max(1, worldH / tileWorld));
  t.needsUpdate = true;
  return t;
}

export function usesArtFloor(styleId: string | undefined | null): boolean {
  return Boolean(styleId && styleId !== 'default' && styleId !== 'map');
}
