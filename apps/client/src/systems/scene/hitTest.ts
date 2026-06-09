import type { BaseItem, Item } from './types';
import { itemDisplayZIndex } from './zOrder';
import { sceneRefs } from './sceneRefs';

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

/** Topmost map under a world point, or null. */
export function hitTestMap(items: Item[], wx: number, wy: number): Item | null {
  const maps = items.filter((i) => i.type === 'map');
  return hitTest(maps, wx, wy, { includeLocked: true });
}

/** True when the point is on open map space (no item, or the map background layer). */
export function isMapGroundHit(hit: Item | null): boolean {
  return hit === null || hit.type === 'map';
}

/** Canvas or a child of the Pixi view (pointer / right-click target varies by browser). */
export function isCanvasPointerEvent(e: { target: EventTarget | null }): boolean {
  const canvas = sceneRefs.app.current?.canvas;
  if (!canvas) return false;
  const target = e.target as Node | null;
  return target === canvas || (target != null && canvas.contains(target));
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
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const rad = (-item.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad) + item.width / 2;
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad) + item.height / 2;
  const margin = Math.max(10, Math.min(item.width, item.height) * 0.28);
  return (
    lx > margin && lx < item.width - margin &&
    ly > margin && ly < item.height - margin
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
