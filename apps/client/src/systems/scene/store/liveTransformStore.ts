import { create } from 'zustand';
import type { Item } from '../types';

export interface LiveTransform {
  rotation?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface LiveTransformState {
  byId: Record<string, LiveTransform>;
  /** Bumped on each change so fog can re-render without touching item store. */
  tick: number;
  setLive: (id: string, patch: LiveTransform, opts?: { bumpTick?: boolean }) => void;
  setLiveMany: (entries: Array<{ id: string; patch: LiveTransform }>, opts?: { bumpTick?: boolean }) => void;
  clear: (ids: string[]) => void;
}

export const useLiveTransformStore = create<LiveTransformState>((set) => ({
  byId: {},
  tick: 0,
  setLive: (id, patch, opts) =>
    set((s) => {
      const byId = { ...s.byId, [id]: { ...s.byId[id], ...patch } };
      return opts?.bumpTick === false ? { byId } : { byId, tick: s.tick + 1 };
    }),
  setLiveMany: (entries, opts) =>
    set((s) => {
      const byId = { ...s.byId };
      for (const { id, patch } of entries) {
        byId[id] = { ...byId[id], ...patch };
      }
      return opts?.bumpTick === false ? { byId } : { byId, tick: s.tick + 1 };
    }),
  clear: (ids) =>
    set((s) => {
      if (!ids.length) return s;
      const byId = { ...s.byId };
      let changed = false;
      for (const id of ids) {
        if (id in byId) {
          delete byId[id];
          changed = true;
        }
      }
      return changed ? { byId, tick: s.tick + 1 } : s;
    }),
}));

/** Merge in-progress drag transforms for fog / vision without committing to item store. */
export function itemsWithLiveTransforms(
  items: Record<string, Item>,
  byId: Record<string, LiveTransform>,
): Record<string, Item> {
  const ids = Object.keys(byId);
  if (!ids.length) return items;

  const next = { ...items };
  for (const id of ids) {
    const it = items[id];
    const live = byId[id];
    if (!it || !live) continue;
    next[id] = { ...it, ...live } as Item;
  }
  return next;
}
