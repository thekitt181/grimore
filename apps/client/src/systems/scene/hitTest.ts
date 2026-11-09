import type { BaseItem, Item, MapItem } from './types';
import { itemDisplayZIndex } from './zOrder';
import { sceneRefs } from './sceneRefs';
import { mapPickRank, MODULAR_ROOM_WALL_CELLS, pieceForUrl } from '@/systems/map/library/modularKits';
import { useItemStore } from './store/itemStore';

/**
 * Transform a world-space point into an item's local (un-rotated) space and
 * test whether it falls inside the item's [0,width] x [0,height] box.
 */
export function pointInItem(item: BaseItem, wx: number, wy: number): boolean {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const rad = (-item.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + item.width / 2;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + item.height / 2;
  return lx >= 0 && lx <= item.width && ly >= 0 && ly <= item.height;
}

/**
 * Returns the topmost (highest zIndex) item under the world point, skipping
 * locked items unless includeLocked is true. Hidden-from-player items are
 * the caller's responsibility to filter.
 */
export function hitTest(
  items: Item[],
  wx: number,
  wy: number,
  opts: { includeLocked?: boolean } = {}
): Item | null {
  const sorted = [...items].sort((a, b) => itemDisplayZIndex(b) - itemDisplayZIndex(a));
  for (const it of sorted) {
    if (!opts.includeLocked && it.locked) continue;
    if (pointInItem(it, wx, wy)) return it;
  }
  return null;
}

/** Board with no art and no GLB — leftover empty map that must not own tokens. */
export function isPlaceholderMap(map: Pick<MapItem, 'backgroundUrl' | 'modelUrl'>): boolean {
  return !map.backgroundUrl && !map.modelUrl;
}

/** Topmost map under a world point, or null. Locked floors lose to unlocked walls on top. */
export function hitTestMap(items: Item[], wx: number, wy: number): MapItem | null {
  let hits = items.filter((i): i is MapItem => i.type === 'map' && pointInItem(i, wx, wy));
  const real = hits.filter((m) => !isPlaceholderMap(m));
  if (real.length) hits = real;
  if (hits.length === 0) return null;
  hits.sort((a, b) => mapPickRank(b) - mapPickRank(a));
  return hits[0] ?? null;
}

/** Kit / art map under a world point (never the empty board). */
export function mapAtWorldPoint(wx: number, wy: number): MapItem | null {
  const items = Object.values(useItemStore.getState().items);
  const hit = hitTestMap(items, wx, wy);
  if (!hit || isPlaceholderMap(hit)) return null;
  return hit;
}

export function floorStandRank(map: MapItem): number {
  const p = pieceForUrl(map.modelUrl);
  // Rooms/halls beat doorway tiles even if a tile's AABB was scaled huge.
  const kind =
    p?.kind === 'room' || p?.kind === 'hall' ? 4
    : p?.kind === 'stairs' ? 3
    : p?.kind === 'tile' ? 1
    : map.modelUrl ? 3
    : 2;
  return kind * 1e12 + map.width * map.height;
}

function isStandFloor(i: MapItem): boolean {
  const p = pieceForUrl(i.modelUrl);
  if (p) {
    if (p.kind === 'wall' || p.kind === 'gate') return false;
    return p.kind === 'tile' || p.kind === 'room' || p.kind === 'hall' || p.kind === 'stairs';
  }
  return Boolean(i.modelUrl || i.backgroundUrl);
}

function pointInFloorPad(i: MapItem, wx: number, wy: number, pad: number): boolean {
  if (pad <= 0) return pointInItem(i, wx, wy);
  const cx = i.x + i.width / 2;
  const cy = i.y + i.height / 2;
  const rad = (-i.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= i.width / 2 + pad && Math.abs(ly) <= i.height / 2 + pad;
}

/** KayKit/Kenney wall modules whose box is near the point. */
export function listModularWalls(wx: number, wy: number, pad = 0): MapItem[] {
  const walls: MapItem[] = [];
  for (const i of Object.values(useItemStore.getState().items)) {
    if (i.type !== 'map' || isPlaceholderMap(i)) continue;
    const p = pieceForUrl(i.modelUrl);
    if (p?.kind !== 'wall' && p?.kind !== 'gate') continue;
    if (!pointInFloorPad(i, wx, wy, pad)) continue;
    walls.push(i);
  }
  return walls;
}

/** Walls whose box is near any sample on the walk segment (catches thin slabs in one stride). */
export function listModularWallsAlong(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  pad = 0,
): MapItem[] {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.max(2, Math.ceil(dist / Math.max(16, pad * 0.5)));
  const seen = new Set<string>();
  const walls: MapItem[] = [];
  for (let s = 0; s <= n; s++) {
    const t = s / n;
    for (const wall of listModularWalls(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, pad)) {
      if (seen.has(wall.id)) continue;
      seen.add(wall.id);
      walls.push(wall);
    }
  }
  return walls;
}

/** Floors that contain the point (optional AABB pad for a slab lip). */
export function listStandFloors(wx: number, wy: number, pad = 0): MapItem[] {
  const floors: MapItem[] = [];
  for (const i of Object.values(useItemStore.getState().items)) {
    if (i.type !== 'map' || isPlaceholderMap(i)) continue;
    if (!isStandFloor(i)) continue;
    if (!pointInFloorPad(i, wx, wy, pad)) continue;
    floors.push(i);
  }
  return floors;
}

export function inRoomWallRing(map: MapItem, wx: number, wy: number): boolean {
  const kind = pieceForUrl(map.modelUrl)?.kind;
  if (kind !== 'room' && kind !== 'hall') return false;
  const inset = Math.max(8, map.gridSize) * (kind === 'hall' ? 1.25 : MODULAR_ROOM_WALL_CELLS);
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) > map.width / 2 - inset || Math.abs(ly) > map.height / 2 - inset;
}

function pickStandFloor(floors: MapItem[], wx: number, wy: number): MapItem | null {
  if (floors.length === 0) return null;
  const tiles = floors.filter((f) => pieceForUrl(f.modelUrl)?.kind === 'tile');
  if (tiles.length > 0 && floors.some((f) => inRoomWallRing(f, wx, wy))) {
    tiles.sort((a, b) => a.width * a.height - b.width * b.height);
    return tiles[0] ?? null;
  }
  floors.sort((a, b) => floorStandRank(b) - floorStandRank(a));
  return floors[0] ?? null;
}

/**
 * Floor a token can stand on: rooms/halls/tiles, never walls or the empty board.
 * Prefers rooms/halls over a 2 m doorway tile that overlaps the same point,
 * except in the room wall ring — KayKit path tiles win there so walkers
 * are not treated as standing in the Kenney shell.
 */
export function mapUnderTokenFeet(wx: number, wy: number): MapItem | null {
  return pickStandFloor(listStandFloors(wx, wy, 0), wx, wy);
}

/**
 * Next kit floor whose AABB is within `pad` of the point (the visual lip in front of a slab).
 */
export function mapNearTokenFeet(wx: number, wy: number, pad: number): MapItem | null {
  return pickStandFloor(listStandFloors(wx, wy, pad), wx, wy);
}

/** True when the point is on open map space (no item, or the map background layer). */
export function isMapGroundHit(hit: Item | null): boolean {
  return hit === null || hit.type === 'map';
}

/** Map interaction layer, Pixi canvas, or children (pointer target varies by browser). */
export function isCanvasPointerEvent(e: { target: EventTarget | null }): boolean {
  const pixiCanvas = sceneRefs.app.current?.canvas;
  const interaction = sceneRefs.interactionRoot.current;
  const target = e.target as Node | null;
  if (!target) return false;
  if (interaction && (target === interaction || interaction.contains(target))) return true;
  if (!pixiCanvas) return false;
  return target === pixiCanvas || pixiCanvas.contains(target);
}

/** @deprecated Use isCanvasPointerEvent */
export function isCanvasContextEvent(e: MouseEvent): boolean {
  return isCanvasPointerEvent(e);
}

/** Axis-aligned bounding box of an item's rotated corners (world space). */
export function itemAABB(item: BaseItem): { minX: number; minY: number; maxX: number; maxY: number } {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const hw = item.width / 2, hh = item.height / 2;
  const corners = [
    [-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh],
  ].map(([x, y]) => ({
    x: cx + x! * cos - y! * sin,
    y: cy + x! * sin + y! * cos,
  }));
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

/**
 * True when the point lies in the item interior (inset from edges).
 * Used so drag-to-move wins over resize handles on small tokens.
 */
export function isInteriorClick(item: BaseItem, wx: number, wy: number): boolean {
  return isInteriorClickBounds(
    item.x,
    item.y,
    item.width,
    item.height,
    item.rotation ?? 0,
    wx,
    wy,
  );
}

export function isInteriorClickBounds(
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  wx: number,
  wy: number,
  marginRatio = 0.38,
): boolean {
  const cx = x + width / 2;
  const cy = y + height / 2;
  const rad = (-rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + width / 2;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + height / 2;
  const margin = Math.max(6, Math.min(width, height) * marginRatio);
  return (
    lx > margin && lx < width - margin &&
    ly > margin && ly < height - margin
  );
}

/** Does an item's AABB intersect the given world-space rectangle (marquee)? */
export function itemIntersectsRect(
  item: BaseItem,
  rx: number, ry: number, rw: number, rh: number
): boolean {
  const box = itemAABB(item);
  return box.minX < rx + rw && box.maxX > rx && box.minY < ry + rh && box.maxY > ry;
}
