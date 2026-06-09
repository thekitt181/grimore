import {
  Container,
  Graphics,
  type Renderer,
} from 'pixi.js';
import type { Item, MapItem } from '@/systems/scene/types';
import { cellKey } from './store/mapStore';
import {
  getVisionTokens,
  gmVisibleCells,
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
  fog: Graphics;
  refog: Graphics;
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
  if (cached && !cached.compose.destroyed) return cached;

  fc.removeChildren();

  const compose = new Container();
  compose.label = 'fog-compose';
  const fog = new Graphics();
  fog.label = 'fog-fill';
  const refog = new Graphics();
  refog.label = 'fog-refog';
  compose.addChild(fog, refog);
  fc.addChild(compose);

  const layers: FogLayers = { compose, fog, refog };
  layerCache.set(fc, layers);
  return layers;
}

export function clearFogLayers(layers: FogLayers): void {
  layers.fog.clear();
  layers.refog.clear();
}

function cutPolygon(g: Graphics, poly: { x: number; y: number }[]): void {
  if (poly.length < 3) return;
  g.poly(poly.flatMap((p) => [p.x, p.y])).cut();
}

function cutCell(g: Graphics, cx: number, cy: number, gridSize: number): void {
  g.rect(cx * gridSize, cy * gridSize, gridSize, gridSize).cut();
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

/** Grid holes only deep inside visible area — keeps the cone edge smooth. */
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
 * Full-map fog with smooth cone cutouts (fill first, then Pixi cut holes).
 * Players: polygon holes only. GM: polygon + interior grid patches.
 */
function paintFogGraphics(
  layers: FogLayers,
  map: MapItem,
  opts: FogDrawOptions,
): void {
  const { width, height, gridSize } = map;
  const { fog, refog } = layers;

  fog.clear();
  refog.clear();

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

  // Must fill before cut() — Pixi punches holes into the previous fill instruction.
  fog.rect(0, 0, width, height).fill({ color: FOG_COLOR, alpha: 1 });

  if (polys.length > 0) {
    for (const poly of polys) {
      cutPolygon(fog, poly);
    }

    if (opts.isGM) {
      const visibleCells = gmVisibleCells(
        opts.revealedCells,
        map,
        opts.items,
        opts.selectedIds,
        gridSize,
      );
      for (const key of visibleCells) {
        const cell = parseCellKey(key);
        if (!cell || !isInteriorVisibleCell(cell.x, cell.y, visibleCells)) continue;
        cutCell(fog, cell.x, cell.y, gridSize);
      }
    }
  } else {
    for (let cx = 0; cx < Math.ceil(width / gridSize); cx++) {
      for (let cy = 0; cy < Math.ceil(height / gridSize); cy++) {
        if (!opts.revealedCells.has(cellKey(cx, cy))) continue;
        cutCell(fog, cx, cy, gridSize);
      }
    }
  }

  // Grid refog only on unrevealed interior cone cells (smooth outer edge stays on fog cuts).
  if (!opts.isGM && opts.revealedCells.size > 0 && polys.length > 0) {
    const coneCells = losVisibleCellKeys(map, visionTokens, gridSize, { directional: true });
    for (const key of coneCells) {
      if (opts.revealedCells.has(key)) continue;
      const cell = parseCellKey(key);
      if (!cell || !isInteriorCell(cell.x, cell.y, coneCells)) continue;
      refog
        .rect(cell.x * gridSize, cell.y * gridSize, gridSize, gridSize)
        .fill({ color: FOG_COLOR, alpha: 1 });
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
  clearFogLayers(layers);

  if (!opts.visible) {
    layers.compose.visible = false;
    return;
  }

  const { width, height } = map;
  const gridSize = opts.gridSize;
  if (width <= 0 || height <= 0 || gridSize <= 0) return;

  paintFogGraphics(layers, map, opts);
  layers.compose.visible = true;
  layers.compose.alpha = opts.isGM ? 0.5 : 1;
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
