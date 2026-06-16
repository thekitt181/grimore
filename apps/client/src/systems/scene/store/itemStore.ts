import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { Item, MapItem } from '../types';

export type SelectMode = 'set' | 'add' | 'toggle';

interface ItemState {
  items: Record<string, Item>;
  /** Insertion / z order is tracked by item.zIndex; this is selection only. */
  selectedIds: string[];
  /** Indices into the active map's walls[] — GM wall selection. */
  selectedWallIndices: number[];
  /** The map whose grid drives snapping + fog. */
  activeMapId: string | null;
  snapToGrid: boolean;
  clipboard: Item[];

  // ── CRUD ──────────────────────────────────────────────────────────────────
  addItem: (item: Item) => void;
  /** Add without bumping zIndex / activeMap logic (used by remote sync). */
  upsertItem: (item: Item) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;
  updateItems: (patches: Array<{ id: string; patch: Partial<Item> }>) => void;
  removeItems: (ids: string[]) => void;
  setItems: (items: Item[], activeMapId?: string | null) => void;

  // ── Selection ──────────────────────────────────────────────────────────────
  select: (ids: string[], mode?: SelectMode) => void;
  selectWalls: (indices: number[], mode?: SelectMode) => void;
  clearSelection: () => void;
  clearWallSelection: () => void;

  // ── Flags ────────────────────────────────────────────────────────────────--
  setLocked: (ids: string[], locked: boolean) => void;
  setVisible: (ids: string[], visible: boolean) => void;

  // ── Z-order ──────────────────────────────────────────────────────────────--
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;
  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;

  // ── Clipboard ──────────────────────────────────────────────────────────────
  duplicate: (ids: string[]) => Item[];
  copy: (ids: string[]) => void;
  paste: () => Item[];

  // ── Misc ─────────────────────────────────────────────────────────────────--
  setActiveMap: (id: string | null) => void;
  setSnap: (snap: boolean) => void;
  reset: () => void;
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function maxZ(items: Record<string, Item>): number {
  let m = 0;
  for (const it of Object.values(items)) m = Math.max(m, it.zIndex);
  return m;
}

function minZ(items: Record<string, Item>): number {
  let m = 0;
  for (const it of Object.values(items)) m = Math.min(m, it.zIndex);
  return m;
}

/** Maps render below everything else by default (lowest z band). */
function defaultZForType(items: Record<string, Item>, type: Item['type']): number {
  if (type === 'map') {
    // Maps stack just above other maps but below tokens/drawings.
    const mapZs = Object.values(items).filter((i) => i.type === 'map').map((i) => i.zIndex);
    return (mapZs.length ? Math.max(...mapZs) : 0) + 1;
  }
  return maxZ(items) + 1;
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useItemStore = create<ItemState>((set, get) => ({
  items: {},
  selectedIds: [],
  selectedWallIndices: [],
  activeMapId: null,
  snapToGrid: false,
  clipboard: [],

  addItem: (item) =>
    set((s) => {
      const zIndex = item.zIndex ?? defaultZForType(s.items, item.type);
      const next = { ...s.items, [item.id]: { ...item, zIndex } };
      const activeMapId =
        item.type === 'map' && s.activeMapId === null ? item.id : s.activeMapId;
      return { items: next, activeMapId };
    }),

  upsertItem: (item) =>
    set((s) => {
      const activeMapId =
        item.type === 'map' && s.activeMapId === null ? item.id : s.activeMapId;
      return { items: { ...s.items, [item.id]: item }, activeMapId };
    }),

  updateItem: (id, patch) =>
    set((s) => {
      const existing = s.items[id];
      if (!existing) return s;
      return { items: { ...s.items, [id]: { ...existing, ...patch } as Item } };
    }),

  updateItems: (patches) =>
    set((s) => {
      const next = { ...s.items };
      for (const { id, patch } of patches) {
        const existing = next[id];
        if (existing) next[id] = { ...existing, ...patch } as Item;
      }
      return { items: next };
    }),

  removeItems: (ids) =>
    set((s) => {
      const next = { ...s.items };
      for (const id of ids) delete next[id];
      const idset = new Set(ids);
      const selectedIds = s.selectedIds.filter((sid) => !idset.has(sid));
      let activeMapId = s.activeMapId;
      if (activeMapId && idset.has(activeMapId)) {
        const firstMap = Object.values(next).find((i) => i.type === 'map');
        activeMapId = firstMap?.id ?? null;
      }
      return { items: next, selectedIds, activeMapId };
    }),

  setItems: (items, activeMapId) =>
    set(() => {
      const rec: Record<string, Item> = {};
      for (const it of items) rec[it.id] = it;
      const maps = items.filter((i) => i.type === 'map');
      let nextActive = activeMapId ?? null;
      if (nextActive && !rec[nextActive]) nextActive = null;
      if (!nextActive) nextActive = maps[0]?.id ?? null;
      return { items: rec, activeMapId: nextActive, selectedIds: [], selectedWallIndices: [] };
    }),

  // ── Selection ──────────────────────────────────────────────────────────────
  select: (ids, mode = 'set') =>
    set((s) => {
      if (mode === 'set') return { selectedIds: [...new Set(ids)] };
      if (mode === 'add') return { selectedIds: [...new Set([...s.selectedIds, ...ids])] };
      const cur = new Set(s.selectedIds);
      for (const id of ids) { if (cur.has(id)) cur.delete(id); else cur.add(id); }
      return { selectedIds: [...cur] };
    }),

  selectWalls: (indices, mode = 'set') =>
    set((s) => {
      const uniq = [...new Set(indices.filter((i) => i >= 0))];
      if (mode === 'set') return { selectedWallIndices: uniq };
      if (mode === 'add') return { selectedWallIndices: [...new Set([...s.selectedWallIndices, ...uniq])] };
      const cur = new Set(s.selectedWallIndices);
      for (const i of uniq) { if (cur.has(i)) cur.delete(i); else cur.add(i); }
      return { selectedWallIndices: [...cur] };
    }),

  clearSelection: () => set({ selectedIds: [], selectedWallIndices: [] }),

  clearWallSelection: () => set({ selectedWallIndices: [] }),

  // ── Flags ────────────────────────────────────────────────────────────────--
  setLocked: (ids, locked) =>
    set((s) => {
      const next = { ...s.items };
      for (const id of ids) { if (next[id]) next[id] = { ...next[id]!, locked } as Item; }
      return { items: next };
    }),

  setVisible: (ids, visible) =>
    set((s) => {
      const next = { ...s.items };
      for (const id of ids) { if (next[id]) next[id] = { ...next[id]!, visible } as Item; }
      return { items: next };
    }),

  // ── Z-order ──────────────────────────────────────────────────────────────--
  bringForward: (id) =>
    set((s) => {
      const it = s.items[id];
      if (!it) return s;
      return { items: { ...s.items, [id]: { ...it, zIndex: it.zIndex + 1 } as Item } };
    }),

  sendBackward: (id) =>
    set((s) => {
      const it = s.items[id];
      if (!it) return s;
      return { items: { ...s.items, [id]: { ...it, zIndex: it.zIndex - 1 } as Item } };
    }),

  bringToFront: (id) =>
    set((s) => {
      const it = s.items[id];
      if (!it) return s;
      return { items: { ...s.items, [id]: { ...it, zIndex: maxZ(s.items) + 1 } as Item } };
    }),

  sendToBack: (id) =>
    set((s) => {
      const it = s.items[id];
      if (!it) return s;
      return { items: { ...s.items, [id]: { ...it, zIndex: minZ(s.items) - 1 } as Item } };
    }),

  // ── Clipboard ──────────────────────────────────────────────────────────────
  duplicate: (ids) => {
    const s = get();
    const created: Item[] = [];
    const next = { ...s.items };
    let z = maxZ(s.items);
    for (const id of ids) {
      const orig = s.items[id];
      if (!orig) continue;
      z += 1;
      const clone = { ...orig, id: uuidv4(), x: orig.x + 40, y: orig.y + 40, zIndex: z } as Item;
      next[clone.id] = clone;
      created.push(clone);
    }
    set({ items: next, selectedIds: created.map((c) => c.id) });
    return created;
  },

  copy: (ids) =>
    set((s) => {
      const clip = ids.map((id) => s.items[id]).filter(Boolean) as Item[];
      return { clipboard: clip.map((c) => ({ ...c })) };
    }),

  paste: () => {
    const s = get();
    if (!s.clipboard.length) return [];
    const created: Item[] = [];
    const next = { ...s.items };
    let z = maxZ(s.items);
    for (const orig of s.clipboard) {
      z += 1;
      const clone = { ...orig, id: uuidv4(), x: orig.x + 40, y: orig.y + 40, zIndex: z } as Item;
      next[clone.id] = clone;
      created.push(clone);
    }
    set({ items: next, selectedIds: created.map((c) => c.id) });
    return created;
  },

  // ── Misc ─────────────────────────────────────────────────────────────────--
  setActiveMap: (activeMapId) => set({ activeMapId }),
  setSnap: (snapToGrid) => set({ snapToGrid }),

  reset: () => set({ items: {}, selectedIds: [], selectedWallIndices: [], activeMapId: null, clipboard: [] }),
}));

// ─── Selectors ──────────────────────────────────────────────────────────────--

/** All items as an array sorted by zIndex (ascending = bottom first). */
export function selectSortedItems(s: ItemState): Item[] {
  return Object.values(s.items).sort((a, b) => a.zIndex - b.zIndex);
}

/** The active map item (drives grid + fog + snapping). */
export function getActiveMap(): MapItem | null {
  const s = useItemStore.getState();
  if (s.activeMapId) {
    const m = s.items[s.activeMapId];
    if (m && m.type === 'map') return m;
  }
  const first = Object.values(s.items).find((i) => i.type === 'map');
  return (first as MapItem) ?? null;
}
