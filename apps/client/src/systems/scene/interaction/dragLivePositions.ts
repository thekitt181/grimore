import type { Item } from '@/systems/scene/types';

/** In-flight drag positions — avoids zustand/React churn while moving tokens. */
const positions = new Map<string, { x: number; y: number }>();

export function setDragLivePosition(id: string, x: number, y: number): void {
  positions.set(id, { x, y });
}

export function setDragLivePositions(entries: Array<{ id: string; x: number; y: number }>): void {
  for (const { id, x, y } of entries) positions.set(id, { x, y });
}

export function getDragLivePosition(id: string): { x: number; y: number } | undefined {
  return positions.get(id);
}

export function clearDragLivePositions(ids: string[]): void {
  for (const id of ids) positions.delete(id);
}

export function hasDragLivePositions(): boolean {
  return positions.size > 0;
}

/** Merge in-flight drag x/y into items for fog visibility / hit-testing. */
export function itemsWithDragLiveTransforms(
  items: Record<string, Item>,
): Record<string, Item> {
  if (positions.size === 0) return items;
  const next = { ...items };
  for (const [id, pos] of positions) {
    const it = items[id];
    if (!it) continue;
    next[id] = { ...it, x: pos.x, y: pos.y };
  }
  return next;
}
