import type { Point } from '@grimoire/fog-engine';
import type { Item, MapItem, TokenItem, WallSegment } from '@/systems/scene/types';
import { cellKey } from './store/mapStore';

export const DEFAULT_VISION_CELLS = 12;
export const DEFAULT_VISION_FT = DEFAULT_VISION_CELLS * 5;
/** Total vision cone width in degrees (centered on token facing). */
export const DEFAULT_VISION_ARC_DEG = 90;

/** Player vision is a smooth circle/cone — not wall-blocked or grid-square clipped. */
const SMOOTH_CIRCLE_SEGMENTS = 96;

export interface LosOptions {
  /** When true, vision is a forward arc based on token rotation (players). */
  directional?: boolean;
}

export function visionArcRad(token: TokenItem): number {
  const deg = token.visionArc ?? DEFAULT_VISION_ARC_DEG;
  return (Math.max(15, Math.min(360, deg)) * Math.PI) / 180;
}

export function visionFeet(token: TokenItem): number {
  return (token.visionRadius ?? 0) * 5;
}

export function visionRadiusFromFeet(feet: number): number {
  return Math.max(0, feet) / 5;
}

/** Facing angle in map-local radians — matches rotate-handle math (0° = north/up). */
export function tokenFacingRad(token: TokenItem, map: MapItem): number {
  const deg = token.rotation - map.rotation;
  return (deg * Math.PI) / 180 - Math.PI / 2;
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

/** Grid-aligned square footprint — used for legacy helpers only. */
export function visionBounds(
  token: TokenItem,
  map: MapItem,
  gridSize: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  const { x: cx, y: cy } = tokenMapOrigin(token, map);
  const cells = token.visionRadius ?? 0;
  const radiusPx = Math.max(1, cells) * gridSize;
  return {
    minX: Math.max(0, cx - radiusPx),
    minY: Math.max(0, cy - radiusPx),
    maxX: Math.min(map.width, cx + radiusPx),
    maxY: Math.min(map.height, cy + radiusPx),
  };
}

function pointOnVisionRay(
  origin: Point,
  angle: number,
  radius: number,
  mapW: number,
  mapH: number,
): Point {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let r = radius;
  if (dx > 1e-10) r = Math.min(r, (mapW - origin.x) / dx);
  else if (dx < -1e-10) r = Math.min(r, (0 - origin.x) / dx);
  if (dy > 1e-10) r = Math.min(r, (mapH - origin.y) / dy);
  else if (dy < -1e-10) r = Math.min(r, (0 - origin.y) / dy);
  r = Math.max(0, r);
  return { x: origin.x + dx * r, y: origin.y + dy * r };
}

function smoothVisionCircle(
  origin: Point,
  radius: number,
  mapW: number,
  mapH: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i < SMOOTH_CIRCLE_SEGMENTS; i++) {
    const a = (2 * Math.PI * i) / SMOOTH_CIRCLE_SEGMENTS;
    points.push(pointOnVisionRay(origin, a, radius, mapW, mapH));
  }
  return points;
}

function smoothVisionCone(
  origin: Point,
  radius: number,
  facing: number,
  arc: number,
  mapW: number,
  mapH: number,
): Point[] {
  const half = arc / 2;
  const minA = facing - half;
  const steps = Math.max(48, Math.ceil((arc / (2 * Math.PI)) * SMOOTH_CIRCLE_SEGMENTS));
  const points: Point[] = [origin];
  for (let i = 0; i <= steps; i++) {
    const a = minA + (arc * i) / steps;
    points.push(pointOnVisionRay(origin, a, radius, mapW, mapH));
  }
  return points;
}

/** Tokens on this map that contribute line-of-sight. */
export function getVisionTokens(
  items: Record<string, Item>,
  selectedIds: string[],
  isGM: boolean,
  userId: string | null,
  map: MapItem,
): TokenItem[] {
  const visibleOnMap = (t: TokenItem) =>
    t.type === 'token' && t.visible !== false && tokenOnMap(t, map);

  if (isGM) {
    if (selectedIds.length === 0) return [];
    return selectedIds
      .map((id) => items[id])
      .filter((i): i is TokenItem => i?.type === 'token' && visibleOnMap(i));
  }

  const uid = userId?.trim() ?? '';
  const selectedTokens = selectedIds
    .map((id) => items[id])
    .filter((i): i is TokenItem => {
      if (i?.type !== 'token' || !visibleOnMap(i)) return false;
      const owner = i.ownerId?.trim() ?? '';
      return !owner || owner === uid;
    });

  // Explicit selection wins over assignment (pick which PC drives vision).
  if (selectedTokens.length > 0) return selectedTokens;

  if (!uid) return [];

  return Object.values(items).filter(
    (i): i is TokenItem => i.type === 'token' && visibleOnMap(i) && i.ownerId?.trim() === uid,
  );
}

/** Smooth circle/cone vision polygons — no wall blocking or auto LOS prediction. */
export function losPolygons(
  map: MapItem,
  tokens: TokenItem[],
  gridSize: number,
  options: LosOptions = {},
): Point[][] {
  if (tokens.length === 0) return [];
  const directional = options.directional ?? false;
  const mapW = map.width;
  const mapH = map.height;

  return tokens.map((token) => {
    const origin = tokenMapOrigin(token, map);
    const radius = (token.visionRadius ?? 0) * gridSize;
    const arc = visionArcRad(token);
    if (directional && arc < Math.PI * 2 - 0.01) {
      return smoothVisionCone(origin, radius, tokenFacingRad(token, map), arc, mapW, mapH);
    }
    return smoothVisionCircle(origin, radius, mapW, mapH);
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
  return true;
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

/** Rasterize vision to grid cells (distance + arc only — no wall blocking). */
function computeLosVisibleCellKeys(
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

  for (const token of tokens) {
    const origin = tokenMapOrigin(token, map);
    const radiusPx = (token.visionRadius ?? 0) * gridSize;
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

const losCellCache = new Map<string, Set<string>>();
const LOS_CACHE_MAX = 64;

function tokensSignature(map: MapItem, tokens: TokenItem[]): string {
  return tokens.map((t) => {
    const o = tokenMapOrigin(t, map);
    return `${t.id}:${o.x.toFixed(1)}:${o.y.toFixed(1)}:${t.rotation.toFixed(1)}:${t.visionRadius ?? 0}:${t.visionArc ?? DEFAULT_VISION_ARC_DEG}`;
  }).join(';');
}

function trimLosCache(): void {
  while (losCellCache.size > LOS_CACHE_MAX) {
    const first = losCellCache.keys().next().value;
    if (first == null) break;
    losCellCache.delete(first);
  }
}

/** Cached LOS raster — keyed by map geometry + token positions (safe across drag frames). */
export function losVisibleCellKeys(
  map: MapItem,
  tokens: TokenItem[],
  gridSize: number,
  options: LosOptions = {},
): Set<string> {
  const directional = options.directional ?? false;
  const key = `${map.id}|${gridSize}|${directional ? 1 : 0}|${tokensSignature(map, tokens)}`;
  const hit = losCellCache.get(key);
  if (hit) return hit;

  const cells = computeLosVisibleCellKeys(map, tokens, gridSize, options);
  losCellCache.set(key, cells);
  trimLosCache();
  return cells;
}

export function clearLosCellCache(): void {
  losCellCache.clear();
}

/** Grid cells a token overlaps on a map (map-local coordinates). */
export function tokenOccupiedCellKeys(
  token: TokenItem,
  map: MapItem,
  gridSize: number,
): Set<string> {
  const { x: cx, y: cy } = tokenMapOrigin(token, map);
  const minX = cx - token.width / 2;
  const maxX = cx + token.width / 2;
  const minY = cy - token.height / 2;
  const maxY = cy + token.height / 2;
  const cols = Math.ceil(map.width / gridSize);
  const rows = Math.ceil(map.height / gridSize);
  const x0 = Math.max(0, Math.floor(minX / gridSize));
  const y0 = Math.max(0, Math.floor(minY / gridSize));
  const x1 = Math.min(cols - 1, Math.floor(maxX / gridSize));
  const y1 = Math.min(rows - 1, Math.floor(maxY / gridSize));
  const keys = new Set<string>();
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) {
      keys.add(cellKey(x, y));
    }
  }
  return keys;
}

/** True when this player has an assigned or selected token driving vision. */
export function playerHasVisionSource(
  items: Record<string, Item>,
  userId: string | null,
  selectedIds: string[],
  map: MapItem,
): boolean {
  return getVisionTokens(items, selectedIds, false, userId, map).length > 0;
}

/** Cells currently visible via assigned/selected token LOS (for token visibility). */
export function playerTokenLosCells(
  map: MapItem,
  items: Record<string, Item>,
  userId: string | null,
  selectedIds: string[],
  gridSize: number,
): Set<string> {
  const tokens = getVisionTokens(items, selectedIds, false, userId, map);
  if (tokens.length === 0) return new Set();
  return losVisibleCellKeys(map, tokens, gridSize, { directional: true });
}

/** Cells a player can see — only when they have a vision source (assigned or selected token). */
export function playerSeenCellKeys(
  revealedCells: Set<string>,
  map: MapItem,
  items: Record<string, Item>,
  userId: string | null,
  selectedIds: string[],
  gridSize: number,
): Set<string> {
  if (!playerHasVisionSource(items, userId, selectedIds, map)) {
    return new Set();
  }
  return playerVisibleCells(revealedCells, map, items, userId, selectedIds, gridSize);
}

/** Whether a player may render this token while fog is active. */
export function isTokenVisibleToPlayer(
  token: TokenItem,
  map: MapItem,
  seenCells: Set<string>,
): boolean {
  if (seenCells.size === 0 || !tokenOnMap(token, map)) return false;
  for (const key of tokenOccupiedCellKeys(token, map, map.gridSize)) {
    if (seenCells.has(key)) return true;
  }
  return false;
}

/** Cells a player can see: live token LOS plus GM-revealed (explored) cells. */
export function playerVisibleCells(
  revealedCells: Set<string>,
  map: MapItem,
  items: Record<string, Item>,
  userId: string | null,
  selectedIds: string[],
  gridSize: number,
): Set<string> {
  const tokens = getVisionTokens(items, selectedIds, false, userId, map);
  const los = losVisibleCellKeys(map, tokens, gridSize, { directional: true });
  const visible = new Set(revealedCells);
  for (const k of los) visible.add(k);
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
