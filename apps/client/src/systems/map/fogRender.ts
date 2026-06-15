import {
  CanvasSource,
  Container,
  Sprite,
  Texture,
  type Renderer,
} from 'pixi.js';
import type { Item, MapItem } from '@/systems/scene/types';
import { cellKey } from './store/mapStore';
import {
  getVisionTokens,
  losPolygons,
  losVisibleCellKeys,
} from './fogLos';

export interface FogDrawOptions {
  revealedCells: Set<string>;
  gridSize: number;
  isGM: boolean;
  items: Record<string, Item>;
  selectedIds: string[];
  myUserId: string | null;
  visible: boolean;
}

export interface FogLayers {
  compose: Container;
  fogSprite: Sprite;
  fogCanvas: HTMLCanvasElement;
  fogTexture: Texture;
}

const layerCache = new WeakMap<Container, FogLayers>();

function parseCellKey(key: string): { x: number; y: number } | null {
  const [sx, sy] = key.split(',');
  const x = Number(sx);
  const y = Number(sy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

export function ensureFogLayers(fc: Container): FogLayers {
  const cached = layerCache.get(fc);
  if (cached && !cached.compose.destroyed && cached.fogCanvas) return cached;

  fc.removeChildren();

  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const source = new CanvasSource({ resource: canvas, transparent: true });
  const texture = new Texture({ source });
  const fogSprite = new Sprite(texture);
  fogSprite.label = 'fog-fill';

  const compose = new Container();
  compose.label = 'fog-compose';
  compose.addChild(fogSprite);
  fc.addChild(compose);

  const layers: FogLayers = { compose, fogSprite, fogCanvas: canvas, fogTexture: texture };
  layerCache.set(fc, layers);
  return layers;
}

function resizeFogCanvas(layers: FogLayers, width: number, height: number): void {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (layers.fogCanvas.width === w && layers.fogCanvas.height === h) return;
  layers.fogCanvas.width = w;
  layers.fogCanvas.height = h;
  layers.fogTexture.source.resize(w, h);
}

export function clearFogLayers(layers: FogLayers): void {
  const ctx = layers.fogCanvas.getContext('2d');
  if (ctx) ctx.clearRect(0, 0, layers.fogCanvas.width, layers.fogCanvas.height);
  layers.fogTexture.source.update();
}

function appendPolygonPath(ctx: CanvasRenderingContext2D, poly: { x: number; y: number }[]): void {
  if (poly.length < 3) return;
  ctx.moveTo(poly[0]!.x, poly[0]!.y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i]!.x, poly[i]!.y);
  }
  ctx.closePath();
}

function appendCellPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, gridSize: number): void {
  ctx.rect(cx * gridSize, cy * gridSize, gridSize, gridSize);
}

function isInteriorCell(cx: number, cy: number, cells: Set<string>): boolean {
  return (
    cells.has(cellKey(cx, cy))
    && cells.has(cellKey(cx + 1, cy))
    && cells.has(cellKey(cx - 1, cy))
    && cells.has(cellKey(cx, cy + 1))
    && cells.has(cellKey(cx, cy - 1))
  );
}

/** Wipe the canvas each frame so prior vision holes cannot linger in the GPU texture. */
function resetFogCanvas(ctx: CanvasRenderingContext2D): void {
  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'copy';
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  ctx.restore();
}

/** Paint fog-of-war to a canvas (map-local coordinates). */
export function paintFogCanvas(
  ctx: CanvasRenderingContext2D,
  map: MapItem,
  opts: FogDrawOptions,
): void {
  const { width, height, gridSize } = map;
  const canvasW = ctx.canvas.width;
  const canvasH = ctx.canvas.height;
  if (width <= 0 || height <= 0 || gridSize <= 0 || !opts.visible) {
    ctx.clearRect(0, 0, canvasW, canvasH);
    return;
  }

  resetFogCanvas(ctx);

  const visionTokens = getVisionTokens(
    opts.items,
    opts.selectedIds,
    opts.isGM,
    opts.isGM ? null : opts.myUserId,
    map,
  );

  const polys = visionTokens.length > 0
    ? losPolygons(map, visionTokens, gridSize, { directional: true })
    : [];

  // Even-odd fill: one fresh fog layer per frame (map minus vision holes minus GM reveals).
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.rect(0, 0, width, height);

  if (polys.length > 0) {
    for (const poly of polys) {
      appendPolygonPath(ctx, poly);
    }

    // GM: punch manual reveals only when not previewing a token vision cone.
    if (opts.isGM && opts.selectedIds.length === 0) {
      for (const key of opts.revealedCells) {
        const cell = parseCellKey(key);
        if (!cell) continue;
        appendCellPath(ctx, cell.x, cell.y, gridSize);
      }
    }
  } else {
    for (let cx = 0; cx < Math.ceil(width / gridSize); cx++) {
      for (let cy = 0; cy < Math.ceil(height / gridSize); cy++) {
        if (!opts.revealedCells.has(cellKey(cx, cy))) continue;
        appendCellPath(ctx, cx, cy, gridSize);
      }
    }
  }

  ctx.fill('evenodd');

  if (!opts.isGM && opts.revealedCells.size > 0 && polys.length > 0) {
    ctx.fillStyle = '#000000';
    const coneCells = losVisibleCellKeys(map, visionTokens, gridSize, { directional: true });
    for (const key of coneCells) {
      if (opts.revealedCells.has(key)) continue;
      const cell = parseCellKey(key);
      if (!cell || !isInteriorCell(cell.x, cell.y, coneCells)) continue;
      ctx.fillRect(cell.x * gridSize, cell.y * gridSize, gridSize, gridSize);
    }
  }
}

/** Draw fog-of-war (map-local coordinates). */
export function drawFogLayers(
  layers: FogLayers,
  map: MapItem,
  opts: FogDrawOptions,
  _renderer: Renderer | null,
): void {
  if (!opts.visible) {
    clearFogLayers(layers);
    layers.compose.visible = false;
    return;
  }

  const { width, height } = map;
  const gridSize = opts.gridSize;
  if (width <= 0 || height <= 0 || gridSize <= 0) {
    clearFogLayers(layers);
    return;
  }

  resizeFogCanvas(layers, width, height);
  const ctx = layers.fogCanvas.getContext('2d');
  if (!ctx) return;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  paintFogCanvas(ctx, map, opts);
  layers.fogTexture.source.update();
  layers.fogSprite.width = width;
  layers.fogSprite.height = height;
  layers.compose.visible = true;
  layers.compose.alpha = opts.isGM ? 0.5 : 1;
}

/** @deprecated Use drawFogLayers. */
export function drawFogGraphics(
  g: import('pixi.js').Graphics,
  map: MapItem,
  opts: FogDrawOptions,
  renderer: Renderer,
): void {
  const parent = g.parent as Container | null;
  if (!parent) return;
  drawFogLayers(ensureFogLayers(parent), map, opts, renderer);
}
