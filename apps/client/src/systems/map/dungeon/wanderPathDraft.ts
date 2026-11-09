import { useMapStore } from '@/systems/map/store/mapStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';

export type WanderPathPoint = { x: number; y: number };

export type WanderPathDraft = {
  tokenIds: string[];
  points: WanderPathPoint[];
};

let draft: WanderPathDraft | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

export function getWanderPathDraft(): WanderPathDraft | null {
  return draft;
}

export function subscribeWanderPathDraft(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function beginWanderPath(tokenIds: string[]): void {
  const ids = tokenIds.filter((id) => {
    const it = useItemStore.getState().items[id];
    return it?.type === 'token' && !it.locked;
  });
  if (ids.length === 0) return;
  draft = { tokenIds: ids, points: [] };
  useMapStore.getState().setTool('wander-path');
  emit();
}

export function addWanderPathPoint(point: WanderPathPoint): void {
  if (!draft) return;
  const last = draft.points[draft.points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.y - last.y) < 8) return;
  draft = { ...draft, points: [...draft.points, point] };
  emit();
}

export function undoWanderPathPoint(): void {
  if (!draft || draft.points.length === 0) return;
  draft = { ...draft, points: draft.points.slice(0, -1) };
  emit();
}

export function cancelWanderPath(): void {
  if (!draft) return;
  draft = null;
  if (useMapStore.getState().activeTool === 'wander-path') {
    useMapStore.getState().setTool('select');
  }
  emit();
}

export function finishWanderPath(): boolean {
  if (!draft || draft.points.length === 0) {
    cancelWanderPath();
    return false;
  }
  const { tokenIds, points } = draft;
  const patch: Partial<TokenItem> = {
    wanderPath: points.map((p) => ({ x: p.x, y: p.y })),
    wanderChosen: true,
  };
  const updates = tokenIds
    .filter((id) => useItemStore.getState().items[id]?.type === 'token')
    .map((id) => ({ id, patch }));
  if (updates.length > 0) {
    useItemStore.getState().updateItems(updates);
    emitItemUpdate(updates);
    void import('./wanderMonsters').then(({ resetWanderPathIndex }) => {
      resetWanderPathIndex(tokenIds);
    });
  }
  draft = null;
  useMapStore.getState().setTool('select');
  emit();
  return true;
}

export function clearTokensWanderPath(tokenIds: string[]): void {
  const updates = tokenIds
    .filter((id) => {
      const it = useItemStore.getState().items[id];
      return it?.type === 'token' && (it.wanderPath?.length ?? 0) > 0;
    })
    .map((id) => ({ id, patch: { wanderPath: [] } as Partial<TokenItem> }));
  if (updates.length === 0) return;
  useItemStore.getState().updateItems(updates);
  emitItemUpdate(updates);
  void import('./wanderMonsters').then(({ resetWanderPathIndex }) => {
    resetWanderPathIndex(tokenIds);
  });
}
