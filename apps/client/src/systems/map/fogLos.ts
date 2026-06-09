import { computeVisibilityPolygonDirectional, computeVisibilityPolygonInSquare, rayHitSegment } from '@grimoire/fog-engine';
import type { Point, VisionBounds } from '@grimoire/fog-engine';
import type { Item, MapItem, TokenItem, WallSegment } from '@/systems/scene/types';
import { cellKey } from './store/mapStore';

export const DEFAULT_VISION_CELLS = 12;
export const DEFAULT_VISION_FT = DEFAULT_VISION_CELLS * 5;
/** Total vision cone width in degrees (centered on token facing). */
export const DEFAULT_VISION_ARC_DEG = 90;

export interface LosOptions {
  /** When true, vision is a forward arc based on token rotation (players). */
  directional?: boolean;
}

export function visionArcRad(token: TokenItem): number {
  const deg = token.visionArc ?? DEFAULT_VISION_ARC_DEG;
  return (Math.max(15, Math.min(360, deg)) * Math.PI) / 180;
}

export function visionFeet(token: TokenItem): number {
  return (token.visionRadius ?? DEFAULT_VISION_CELLS) * 5;
}

export function visionRadiusFromFeet(feet: number): number {
  return Math.max(1, feet) / 5;
}

/** Facing angle in map-local radians (0 = east, clockwise — matches Pixi rotation). */
export function tokenFacingRad(token: TokenItem, map: MapItem): number {
  return ((token.rotation - map.rotation) * Math.PI) / 180;
}

export function mapBoundaryWalls(width: number, height: number): WallSegment[] {
  return [
    { a: { x: 0, y: 0 }, b: { x: width, y: 0 } },
    { a: { x: width, y: 0 }, b: { x: width, y: height } },
    { a: { x: width, y: height }, b: { x: 0, y: height } },
    { a: { x: 0, y: height }, b: { x: 0, y: 0 } },
  ];
}

export function allMapWalls(map: MapItem): WallSegment[] {
  return [...(map.walls ?? []), ...mapBoundaryWalls(map.width, map.height)];
}

/** Token center in map-local pixels (accounts for map rotation). */
export function tokenMapOrigin(token: TokenItem, map: MapItem): Point {
  const wx = token.x + token.width / 2;
  const wy = token.y + token.height / 2;
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + map.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + map.height / 2,
  };
}

export function tokenOnMap(token: TokenItem, map: MapItem): boolean {
  const { x, y } = tokenMapOrigin(token, map);
  return x >= -token.width && y >= -token.height && x <= map.width + token.width && y <= map.height + token.height;
}

/** Grid-aligned square footprint for token vision (map-local pixels). */
export function visionBounds(
  token: TokenItem,
  map: MapItem,
  gridSize: number,
): VisionBounds {
  const { x: cx, y: cy } = tokenMapOrigin(token, map);
  const cells = token.visionRadius ?? DEFAULT_VISION_CELLS;
  const cxCell = Math.floor(cx / gridSize);
  const cyCell = Math.floor(cy / gridSize);
  const r = Math.max(1, Math.ceil(cells));
  return {
    minX: (cxCell - r) * gridSize,
    minY: (cyCell - r) * gridSize,
    maxX: (cxCell + r + 1) * gridSize,
    maxY: (cyCell + r + 1) * gridSize,
  };
}

function playerControlsToken(token: TokenItem, userId: string | null): boolean {
  if (token.visible === false) return false;
  if (!userId) return token.ownerId === undefined;
  return token.ownerId === undefined || token.ownerId === userId;
}

/** Tokens on this map that contribute line-of-sight. */
export function getVisionTokens(
  items: Record<string, Item>,
  selectedIds: string[],
  isGM: boolean,
  userId: string | null,
  map: MapItem,
): TokenItem[] {
  const onMap = (t: TokenItem) => t.type === 'token' && tokenOnMap(t, map);

  if (isGM) {
    if (selectedIds.length === 0) return [];
    return selectedIds
      .map((id) => items[id])
      .filter((i): i is TokenItem => i?.type === 'token' && onMap(i));
  }

  return Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && onMap(i) && playerControlsToken(i, userId),
  );
}

function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i]!.x;
    const yi = poly[i]!.y;
    const xj = poly[j]!.x;
    const yj = poly[j]!.y;
    const intersect = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Square-bounded or directional ray-cast LOS polygons (wall-aware). */
export function losPolygons(
  map: MapItem,
  tokens: TokenItem[],
  gridSize: number,
  options: LosOptions = {},
): Point[][] {
  if (tokens.length === 0) return [];
  const walls = allMapWalls(map);
  const directional = options.directional ?? false;

  return tokens.map((token) => {
    const origin = tokenMapOrigin(token, map);
    if (directional) {
      const arc = visionArcRad(token);
      if (arc >= Math.PI * 2 - 0.01) {
        const bounds = visionBounds(token, map, gridSize);
        return computeVisibilityPolygonInSquare(origin, walls, bounds);
      }
      const radius = (token.visionRadius ?? DEFAULT_VISION_CELLS) * gridSize;
      return computeVisibilityPolygonDirectional(
        origin,
        walls,
        radius,
        tokenFacingRad(token, map),
        arc,
      );
    }
    const bounds = visionBounds(token, map, gridSize);
    return computeVisibilityPolygonInSquare(origin, walls, bounds);
  });
}

function normalizeAngle(a: number): number {
  let n = a % (2 * Math.PI);
  if (n <= -Math.PI) n += 2 * Math.PI;
  if (n > Math.PI) n -= 2 * Math.PI;
  return n;
}

function angleInArc(angle: number, facing: number, halfArc: number): boolean {
  return Math.abs(normalizeAngle(angle - facing)) <= halfArc + 1e-9;
}

function pointVisibleFromOrigin(
  origin: Point,
  px: number,
  py: number,
  walls: WallSegment[],
  radiusPx: number,
  facing: number,
  halfArc: number,
  directional: boolean,
): boolean {
  const dx = px - origin.x;
  const dy = py - origin.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-6) return true;
  if (dist > radiusPx + 1e-6) return false;
  if (directional && !angleInArc(Math.atan2(dy, dx), facing, halfArc)) return false;

  const dirX = dx / dist;
  const dirY = dy / dist;
  let limit = dist;
  for (const w of walls) {
    const t = rayHitSegment(origin, dirX, dirY, w);
    if (t !== null && t < limit) limit = t;
  }
  return limit >= dist - 0.5;
}

function cellSamplePoints(cx: number, cy: number, gridSize: number): Point[] {
  const x = cx * gridSize;
  const y = cy * gridSize;
  const g = gridSize;
  return [
    { x: x + g / 2, y: y + g / 2 },
    { x: x + g * 0.25, y: y + g * 0.25 },
    { x: x + g * 0.75, y: y + g * 0.25 },
    { x: x + g * 0.75, y: y + g * 0.75 },
    { x: x + g * 0.25, y: y + g * 0.75 },
  ];
}

/** Rasterize vision to grid cells (wall-aware ray checks, multi-sample per cell). */
export function losVisibleCellKeys(
  map: MapItem,
  tokens: TokenItem[],
  gridSize: number,
  options: LosOptions = {},
): Set<string> {
  if (tokens.length === 0) return new Set();

  const cells = new Set<string>();
  const cols = Math.ceil(map.width / gridSize);
  const rows = Math.ceil(map.height / gridSize);
  const directional = options.directional ?? false;
  const walls = allMapWalls(map);

  for (const token of tokens) {
    const origin = tokenMapOrigin(token, map);
    const radiusPx = (token.visionRadius ?? DEFAULT_VISION_CELLS) * gridSize;
    const facing = tokenFacingRad(token, map);
    const halfArc = visionArcRad(token) / 2;

    const x0 = Math.max(0, Math.floor((origin.x - radiusPx) / gridSize));
    const y0 = Math.max(0, Math.floor((origin.y - radiusPx) / gridSize));
    const x1 = Math.min(cols - 1, Math.ceil((origin.x + radiusPx) / gridSize) - 1);
    const y1 = Math.min(rows - 1, Math.ceil((origin.y + radiusPx) / gridSize) - 1);

    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const samples = cellSamplePoints(cx, cy, gridSize);
        const visible = samples.some((p) =>
          pointVisibleFromOrigin(
            origin,
            p.x,
            p.y,
            walls,
            radiusPx,
            facing,
            halfArc,
            directional,
          ),
        );
        if (visible) cells.add(cellKey(cx, cy));
      }
    }
  }
  return cells;
}

/** Cells a player can see: token LOS clipped to GM-revealed area. */
export function playerVisibleCells(
  revealedCells: Set<string>,
  map: MapItem,
  items: Record<string, Item>,
  userId: string | null,
  gridSize: number,
): Set<string> {
  const tokens = getVisionTokens(items, [], false, userId, map);
  const los = losVisibleCellKeys(map, tokens, gridSize, { directional: true });
  const visible = new Set<string>();

  if (revealedCells.size === 0) {
    for (const k of los) visible.add(k);
    return visible;
  }

  for (const k of los) {
    if (revealedCells.has(k)) visible.add(k);
  }
  return visible;
}

/** GM fog preview: revealed cells + optional LOS from selected tokens. */
export function gmVisibleCells(
  revealedCells: Set<string>,
  map: MapItem,
  items: Record<string, Item>,
  selectedIds: string[],
  gridSize: number,
): Set<string> {
  const visible = new Set(revealedCells);
  const tokens = getVisionTokens(items, selectedIds, true, null, map);
  for (const k of losVisibleCellKeys(map, tokens, gridSize, { directional: true })) {
    visible.add(k);
  }
  return visible;
}
