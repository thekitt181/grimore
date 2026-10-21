import type { MapBreachFx, MapItem, WallCut, WallSegment } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemRemove, emitItemUpdate } from '@/systems/scene/sceneSync';
import { useSessionStore } from '@/store/sessionStore';

const MAX_UNDO = 40;

type DecalUndo = { kind: 'decal'; itemId: string };
type BreachUndo = {
  kind: 'breach';
  mapId: string;
  walls: WallSegment[];
  wallCuts: WallCut[];
  breachFx: MapBreachFx | null;
};

export type FpPaintUndoEntry = DecalUndo | BreachUndo;

const stack: FpPaintUndoEntry[] = [];
const listeners = new Set<() => void>();

function notify() {
  for (const cb of listeners) cb();
}

function cloneWalls(walls: WallSegment[]): WallSegment[] {
  return walls.map((w) => ({ a: { ...w.a }, b: { ...w.b } }));
}

function cloneCuts(cuts: WallCut[]): WallCut[] {
  return cuts.map((c) => ({
    ...c,
    wallA: { ...c.wallA },
    wallB: { ...c.wallB },
    points: [...c.points],
  }));
}

export function pushFpDecalUndo(itemId: string): void {
  stack.push({ kind: 'decal', itemId });
  if (stack.length > MAX_UNDO) stack.shift();
  notify();
}

/** Snapshot map wall state before a breach commit. */
export function pushFpBreachUndo(map: MapItem): void {
  stack.push({
    kind: 'breach',
    mapId: map.id,
    walls: cloneWalls(map.walls ?? []),
    wallCuts: cloneCuts(map.wallCuts ?? []),
    breachFx: map.breachFx ? { ...map.breachFx } : null,
  });
  if (stack.length > MAX_UNDO) stack.shift();
  notify();
}

export function canFpPaintUndo(): boolean {
  return stack.length > 0;
}

export function getFpPaintUndoCount(): number {
  return stack.length;
}

export function subscribeFpPaintUndo(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Undo the last spray stroke or wall breach (synced). */
export function undoFpPaintAction(): boolean {
  const entry = stack.pop();
  if (!entry) return false;

  if (entry.kind === 'decal') {
    const item = useItemStore.getState().items[entry.itemId];
    if (item?.type === 'surfaceDecal') {
      const isGM = useSessionStore.getState().myRole === 'GM';
      const myUserId = useSessionStore.getState().myUserId;
      const owned = isGM || (myUserId && item.ownerId === myUserId);
      if (owned) {
        useItemStore.getState().removeItems([entry.itemId]);
        emitItemRemove([entry.itemId]);
      }
    }
    notify();
    return true;
  }

  // Breach restore — GM only.
  if (useSessionStore.getState().myRole !== 'GM') {
    notify();
    return false;
  }
  const map = useItemStore.getState().items[entry.mapId];
  if (!map || map.type !== 'map') {
    notify();
    return false;
  }

  const patch: Partial<MapItem> = {
    walls: cloneWalls(entry.walls),
    wallCuts: cloneCuts(entry.wallCuts),
    breachFx: entry.breachFx ? { ...entry.breachFx } : null,
  };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);
  notify();
  return true;
}

export function clearFpPaintUndo(): void {
  stack.length = 0;
  notify();
}
