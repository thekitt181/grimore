import {
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  type Renderer,
} from 'pixi.js';
import type { Item, MapItem } from '@/systems/scene/types';
import { cellKey } from './store/mapStore';
import {
  getVisionTokens,
  gmVisibleCells,
  losPolygons,
  losVisibleCellKeys,
  playerVisibleCells,
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
  sprite: Sprite;
  rt: RenderTexture | null;
  compose: Container;
  base: Graphics;
  erase: Graphics;
  /** Re-fog smooth cone, then clip revealed cells off it. */
  refog: Graphics;
  refogClip: Graphics;
}

const FOG_COLOR = 0x000000;

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
  if (cached && !cached.sprite.destroyed) return cached;

  fc.removeChildren();

  const compose = new Container();
  compose.label = 'fog-compose';
  const base = new Graphics();
  base.label = 'fog-base';
  const erase = new Graphics();
  erase.label = 'fog-erase';
  erase.blendMode = 'erase';
  const refog = new Graphics();
  refog.label = 'fog-refog';
  const refogClip = new Graphics();
  refogClip.label = 'fog-refog-clip';
  refogClip.blendMode = 'erase';
  compose.addChild(base, erase, refog, refogClip);

  const sprite = new Sprite();
  sprite.label = 'fog-sprite';
  fc.addChild(sprite);

  const layers: FogLayers = { sprite, rt: null, compose, base, erase, refog, refogClip };
  layerCache.set(fc, layers);
  return layers;
}

export function clearFogLayers(layers: FogLayers): void {
  layers.base.clear();
  layers.erase.clear();
  layers.refog.clear();
  layers.refogClip.clear();
}

function ensureRenderTarget(layers: FogLayers, width: number, height: number): void {
  if (!layers.rt || layers.rt.width !== width || layers.rt.height !== height) {
    layers.rt?.destroy(true);
    layers.rt = RenderTexture.create({ width, height });
    layers.sprite.texture = layers.rt;
  }
}

function erasePolygon(g: Graphics, poly: { x: number; y: number }[]): void {
  if (poly.length < 3) return;
  g.poly(poly.flatMap((p) => [p.x, p.y])).fill({ color: 0xffffff, alpha: 1 });
}

function fillFogPolygon(g: Graphics, poly: { x: number; y: number }[]): void {
  if (poly.length < 3) return;
  g.poly(poly.flatMap((p) => [p.x, p.y])).fill({ color: FOG_COLOR, alpha: 1 });
}

function eraseCell(g: Graphics, cx: number, cy: number, gridSize: number): void {
  g.rect(cx * gridSize, cy * gridSize, gridSize, gridSize).fill({ color: 0xffffff, alpha: 1 });
}

/** True when all 4 orthogonal neighbors are also visible — safe to grid-fill without squaring the cone edge. */
function isInteriorVisibleCell(cx: number, cy: number, visible: Set<string>): boolean {
  return (
    visible.has(cellKey(cx, cy))
    && visible.has(cellKey(cx + 1, cy))
    && visible.has(cellKey(cx - 1, cy))
    && visible.has(cellKey(cx, cy + 1))
    && visible.has(cellKey(cx, cy - 1))
  );
}

/**
 * Compose fog into a RenderTexture.
 * Smooth cone from polygon erase; grid cells only patch interior ray gaps.
 */
function composeFogTexture(
  layers: FogLayers,
  map: MapItem,
  opts: FogDrawOptions,
  renderer: Renderer,
): void {
  const { width, height, gridSize } = map;
  const { base, erase, refog, refogClip } = layers;

  base.clear();
  base.rect(0, 0, width, height).fill({ color: FOG_COLOR, alpha: 1 });

  erase.clear();
  erase.blendMode = 'erase';

  const visionTokens = opts.isGM
    ? getVisionTokens(opts.items, opts.selectedIds, true, null, map)
    : getVisionTokens(opts.items, [], false, opts.myUserId, map);

  const polys = visionTokens.length > 0
    ? losPolygons(map, visionTokens, gridSize, { directional: true })
    : [];

  if (polys.length > 0) {
    for (const poly of polys) {
      erasePolygon(erase, poly);
    }

    const visibleCells = opts.isGM
      ? gmVisibleCells(opts.revealedCells, map, opts.items, opts.selectedIds, gridSize)
      : playerVisibleCells(opts.revealedCells, map, opts.items, opts.myUserId, gridSize);

    for (const key of visibleCells) {
      const cell = parseCellKey(key);
      if (!cell || !isInteriorVisibleCell(cell.x, cell.y, visibleCells)) continue;
      eraseCell(erase, cell.x, cell.y, gridSize);
    }
  } else if (opts.isGM) {
    const cols = Math.ceil(width / gridSize);
    const rows = Math.ceil(height / gridSize);
    for (let cx = 0; cx < cols; cx++) {
      for (let cy = 0; cy < rows; cy++) {
        if (!opts.revealedCells.has(cellKey(cx, cy))) continue;
        eraseCell(erase, cx, cy, gridSize);
      }
    }
  }

  refog.clear();
  refogClip.clear();
  refogClip.blendMode = 'erase';

  if (!opts.isGM && opts.revealedCells.size > 0 && polys.length > 0) {
    for (const poly of polys) {
      fillFogPolygon(refog, poly);
    }
    const coneCells = losVisibleCellKeys(map, visionTokens, gridSize, { directional: true });
    for (const key of opts.revealedCells) {
      if (!coneCells.has(key)) continue;
      const cell = parseCellKey(key);
      if (cell) eraseCell(refogClip, cell.x, cell.y, gridSize);
    }
  }

  renderer.render({
    container: layers.compose,
    target: layers.rt!,
    clear: true,
  });
}

/** Draw fog-of-war (map-local coordinates). */
export function drawFogLayers(
  layers: FogLayers,
  map: MapItem,
  opts: FogDrawOptions,
  renderer: Renderer,
): void {
  clearFogLayers(layers);

  if (!opts.visible) return;

  const { width, height } = map;
  const gridSize = opts.gridSize;
  if (width <= 0 || height <= 0 || gridSize <= 0) return;

  ensureRenderTarget(layers, width, height);
  composeFogTexture(layers, map, opts, renderer);

  layers.sprite.alpha = opts.isGM ? 0.5 : 1;
  layers.sprite.width = width;
  layers.sprite.height = height;
}

/** @deprecated Use drawFogLayers. */
export function drawFogGraphics(
  g: Graphics,
  map: MapItem,
  opts: FogDrawOptions,
  renderer: Renderer,
): void {
  const parent = g.parent as Container | null;
  if (!parent) return;
  drawFogLayers(ensureFogLayers(parent), map, opts, renderer);
}
