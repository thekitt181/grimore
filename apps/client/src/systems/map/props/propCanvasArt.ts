import { Texture } from 'pixi.js';
import { canonicalPropId } from './propArt';

const SIZE = 128;
const cache = new Map<string, Texture>();

function noise(ctx: CanvasRenderingContext2D, w: number, h: number, alpha: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 28;
    img.data[i] = Math.min(255, Math.max(0, img.data[i]! + n));
    img.data[i + 1] = Math.min(255, Math.max(0, img.data[i + 1]! + n));
    img.data[i + 2] = Math.min(255, Math.max(0, img.data[i + 2]! + n));
    img.data[i + 3] = Math.min(255, img.data[i + 3]! * alpha);
  }
  ctx.putImageData(img, 0, 0);
}

function woodGrain(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, base: string): void {
  const g = ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, base);
  g.addColorStop(0.45, '#6b4423');
  g.addColorStop(1, base);
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

function paintWeaponRack(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  woodGrain(ctx, 14, 18, 100, 78, '#5a3820');
  ctx.fillStyle = '#3d2412';
  ctx.fillRect(12, 16, 104, 6);
  ctx.fillRect(12, 102, 104, 8);
  ctx.fillStyle = '#6b4423';
  ctx.fillRect(16, 44, 96, 5);
  ctx.fillRect(16, 72, 96, 5);
  const weapons: Array<[number, number, number, string]> = [
    [26, 22, 52, '#b8c0cc'],
    [44, 20, 58, '#9aa4b0'],
    [62, 24, 48, '#c9a84c'],
    [80, 22, 54, '#b8c0cc'],
    [98, 26, 46, '#9aa4b0'],
  ];
  for (const [x, y, h, c] of weapons) {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, 4, h);
    ctx.fillStyle = '#2a1810';
    ctx.fillRect(x - 1, y + h - 6, 6, 4);
  }
  noise(ctx, SIZE, SIZE, 0.35);
}

function paintCage(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#1a1a22';
  ctx.fillRect(20, 24, 88, 80);
  ctx.strokeStyle = '#8a8075';
  ctx.lineWidth = 3;
  for (let i = 0; i < 7; i++) {
    const x = 24 + i * 13;
    ctx.beginPath();
    ctx.moveTo(x, 26);
    ctx.lineTo(x, 102);
    ctx.stroke();
  }
  for (let j = 0; j < 5; j++) {
    const y = 30 + j * 16;
    ctx.beginPath();
    ctx.moveTo(22, y);
    ctx.lineTo(106, y);
    ctx.stroke();
  }
  ctx.fillStyle = '#4a4a52';
  ctx.fillRect(18, 102, 92, 8);
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 22, 92, 88);
  noise(ctx, SIZE, SIZE, 0.25);
}

function paintMural(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  const g = ctx.createLinearGradient(0, 0, SIZE, SIZE);
  g.addColorStop(0, '#6b5a48');
  g.addColorStop(1, '#3d3428');
  ctx.fillStyle = g;
  ctx.fillRect(10, 12, 108, 104);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = '#c9a070';
  ctx.beginPath();
  ctx.arc(64, 58, 28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#8a7060';
  ctx.fillRect(28, 78, 72, 28);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#2a2018';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, 12, 108, 104);
  ctx.fillStyle = 'rgba(30,24,18,0.45)';
  ctx.fillRect(10, 12, 108, 104);
  noise(ctx, SIZE, SIZE, 0.5);
}

function paintArtObject(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#3a3530';
  ctx.beginPath();
  ctx.ellipse(64, 108, 36, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  const ped = ctx.createLinearGradient(52, 48, 76, 108);
  ped.addColorStop(0, '#9a9088');
  ped.addColorStop(1, '#5a5248');
  ctx.fillStyle = ped;
  ctx.fillRect(54, 52, 20, 56);
  const fig = ctx.createRadialGradient(64, 38, 4, 64, 42, 32);
  fig.addColorStop(0, '#e8dcc8');
  fig.addColorStop(0.6, '#c9a84c');
  fig.addColorStop(1, '#6b5840');
  ctx.fillStyle = fig;
  ctx.beginPath();
  ctx.moveTo(64, 18);
  ctx.lineTo(88, 72);
  ctx.lineTo(40, 72);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#2a2018';
  ctx.beginPath();
  ctx.arc(64, 28, 8, 0, Math.PI * 2);
  ctx.fill();
  noise(ctx, SIZE, SIZE, 0.3);
}

function paintSwarm(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = 'rgba(12,10,16,0.15)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 48; i++) {
    const x = 12 + Math.random() * 104;
    const y = 16 + Math.random() * 72;
    ctx.fillStyle = i % 3 === 0 ? '#2a2218' : '#1a1410';
    ctx.beginPath();
    ctx.ellipse(x, y, 3 + Math.random() * 4, 2 + Math.random() * 2, Math.random(), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = 'rgba(90,70,40,0.35)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(20 + i * 16, 20);
    ctx.quadraticCurveTo(64, 8 + i * 4, 108 - i * 10, 24);
    ctx.stroke();
  }
}

function paintDryFountain(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.fillStyle = '#4a4a52';
  ctx.beginPath();
  ctx.ellipse(64, 96, 44, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  const bowl = ctx.createRadialGradient(64, 72, 8, 64, 72, 40);
  bowl.addColorStop(0, '#7a7a82');
  bowl.addColorStop(1, '#3a3a42');
  ctx.fillStyle = bowl;
  ctx.beginPath();
  ctx.ellipse(64, 72, 38, 22, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#5a5a62';
  ctx.fillRect(58, 40, 12, 34);
  ctx.fillStyle = '#6b6b74';
  ctx.beginPath();
  ctx.arc(64, 38, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(20,18,16,0.5)';
  ctx.beginPath();
  ctx.ellipse(64, 74, 28, 14, 0, 0, Math.PI * 2);
  ctx.fill();
  noise(ctx, SIZE, SIZE, 0.35);
}

function paintFloorGlyph(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = '#c9a84c';
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.85;
  const cx = 64;
  const cy = 64;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * 40;
    const y = cy + Math.sin(a) * 40;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function paintTripwire(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = '#8a8075';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, 96);
  ctx.lineTo(120, 32);
  ctx.stroke();
  ctx.fillStyle = '#5a5a62';
  ctx.fillRect(4, 92, 10, 10);
  ctx.fillRect(114, 28, 10, 10);
}

const PAINTERS: Record<string, (ctx: CanvasRenderingContext2D) => void> = {
  'weapon-rack': paintWeaponRack,
  cage: paintCage,
  mural: paintMural,
  'art-object': paintArtObject,
  swarm: paintSwarm,
  'dry-fountain': paintDryFountain,
  'floor-glyph': paintFloorGlyph,
  tripwire: paintTripwire,
};

/** Props drawn with HQ canvas art in 2D — use the same bitmap in 3D billboards. */
export function hasPropCanvasArt(propId: string | undefined): boolean {
  if (!propId) return false;
  return canonicalPropId(propId) in PAINTERS;
}

/** HQ 128px prop sprites — avoids SVG/WebGL black squares in Pixi. */
export function getPropCanvasTexture(propId: string): Texture | null {
  const id = canonicalPropId(propId);
  const paint = PAINTERS[id];
  if (!paint) return null;
  const hit = cache.get(id);
  if (hit && !hit.destroyed) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  paint(ctx);
  const tex = Texture.from(canvas);
  tex.source.scaleMode = 'linear';
  cache.set(id, tex);
  return tex;
}
