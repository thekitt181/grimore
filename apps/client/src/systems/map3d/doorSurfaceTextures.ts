import * as THREE from 'three';
import { resolveDoorSurfaceStyle, type DoorStyleId, type DoorSurfaceStyle } from './doorSurfaceStyles';
import { doorTextureSpec } from './doorPbrAssets';

const TEX = 512;
const cache = new Map<string, THREE.CanvasTexture>();

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function paintWood(ctx: CanvasRenderingContext2D, base: [number, number, number], vertical: boolean): void {
  const img = ctx.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const along = vertical ? y : x;
      const grain = Math.sin(along * 0.08) * 8 + Math.sin(along * 0.31) * 4;
      const knot = ((x * 17 + y * 31) % 97) < 2 ? -18 : 0;
      const i = (y * TEX + x) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] + grain + knot));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + grain * 0.9 + knot));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + grain * 0.85 + knot));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Inset panels + braces so doors read as doors even on flat albedo. */
function paintDoorPanelLayout(ctx: CanvasRenderingContext2D, theme: DoorSurfaceStyle, stoneLike: boolean): void {
  const margin = 28;
  const innerW = TEX - margin * 2;
  const innerH = TEX - margin * 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.42)';
  ctx.lineWidth = 8;
  ctx.strokeRect(margin, margin, innerW, innerH);
  ctx.strokeStyle = `rgba(255,255,255,${stoneLike ? 0.06 : 0.1})`;
  ctx.lineWidth = 3;
  ctx.strokeRect(margin + 6, margin + 6, innerW - 12, innerH - 12);

  const plankCount = stoneLike ? 3 : 5;
  const plankW = innerW / plankCount;
  for (let i = 1; i < plankCount; i++) {
    const x = margin + i * plankW;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(x - 3, margin + 10, 6, innerH - 20);
  }
  const bands = stoneLike ? [0.38, 0.62] : [0.34, 0.5, 0.66];
  for (const t of bands) {
    const y = margin + innerH * t;
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fillRect(margin + 8, y, innerW - 16, stoneLike ? 16 : 12);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(margin + 8, y + 2, innerW - 16, 3);
  }

  ctx.fillStyle = theme.trim;
  ctx.globalAlpha = 0.35;
  ctx.fillRect(margin - 4, margin - 4, innerW + 8, 10);
  ctx.fillRect(margin - 4, margin + innerH - 6, innerW + 8, 10);
  ctx.fillRect(margin - 4, margin, 10, innerH);
  ctx.fillRect(margin + innerW - 6, margin, 10, innerH);
  ctx.globalAlpha = 1;
}

function paintMetal(ctx: CanvasRenderingContext2D, base: [number, number, number], rusty: boolean): void {
  const img = ctx.createImageData(TEX, TEX);
  const d = img.data;
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const n = ((x * 928371 + y * 689287) % 1000) / 1000;
      const scratch = Math.sin(x * 0.04 + y * 0.02) * 6;
      const spot = rusty && n > 0.92 ? 28 : 0;
      const i = (y * TEX + x) * 4;
      d[i] = Math.max(0, Math.min(255, base[0] + scratch + spot));
      d[i + 1] = Math.max(0, Math.min(255, base[1] + scratch * 0.8 + spot * 0.6));
      d[i + 2] = Math.max(0, Math.min(255, base[2] + scratch * 0.7));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 2;
  for (let y = 64; y < TEX; y += 64) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(TEX, y);
    ctx.stroke();
  }
  for (let x = 64; x < TEX; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEX);
    ctx.stroke();
  }
}

/** HQ fallback door albedo while PBR loads or if fetch fails. */
export function getDoorPanelTexture(doorStyleId: string | undefined | null): THREE.CanvasTexture | null {
  const id = (doorStyleId ?? 'mixed') as DoorStyleId;
  const key = `door:${id}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const theme = resolveDoorSurfaceStyle(id);
  const spec = doorTextureSpec(id);
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  const ctx = canvas.getContext('2d')!;
  const base = hexRgb(theme.panel);

  const stoneLike = spec.family === 'wall' || spec.family === 'arcane';
  if (spec.family === 'wood' || id === 'oak' || id === 'elven') {
    paintWood(ctx, base, true);
  } else if (spec.family === 'metal' || spec.family === 'barred') {
    paintMetal(ctx, base, id.includes('rust') || id === 'fel');
  } else {
    paintWood(ctx, hexRgb(theme.panelDark), false);
  }
  paintDoorPanelLayout(ctx, theme, stoneLike || spec.family === 'metal');

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 16;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}
