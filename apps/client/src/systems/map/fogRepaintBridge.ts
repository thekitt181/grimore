import { useSessionStore } from '@/store/sessionStore';
import { getVisionTokens } from '@/systems/map/fogLos';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { hasDragLivePositions } from '@/systems/scene/interaction/dragLivePositions';
import { isItemDragActive } from '@/systems/scene/interaction/selectionDragState';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import type { Item, TokenItem } from '@/systems/scene/types';
import { itemLightSpec } from '@/systems/scene/sceneLights';

type FogRepaintListener = () => void;

const listeners = new Set<FogRepaintListener>();
let subscriptionsBound = false;
let pendingRepaint = false;
let deferredFogWork = false;
let visibilityRaf = 0;

function visionTokenIds(): Set<string> {
  const map = getActiveMap();
  if (!map) return new Set();
  const { items, selectedIds } = useItemStore.getState();
  const { myRole, myUserId } = useSessionStore.getState();
  const isGM = myRole === 'GM';
  return new Set(
    getVisionTokens(items, selectedIds, isGM, isGM ? null : myUserId, map).map((t) => t.id),
  );
}

function tokenDrivesFog(it: TokenItem, visionIds: Set<string>): boolean {
  if (visionIds.has(it.id)) return true;
  if (it.isPc) return true;
  if (it.ownerId) return true;
  return false;
}

function itemDrivesFog(it: Item, visionIds: Set<string>): boolean {
  if (it.type === 'token' && tokenDrivesFog(it, visionIds)) return true;
  return itemLightSpec(it) != null;
}

function lightItemIds(): Set<string> {
  const ids = new Set<string>();
  for (const it of Object.values(useItemStore.getState().items)) {
    if (itemLightSpec(it)) ids.add(it.id);
  }
  return ids;
}

function scheduleSceneVisibilityUpdate(): void {
  if (visibilityRaf) return;
  visibilityRaf = requestAnimationFrame(() => {
    visibilityRaf = 0;
    requestSceneVisibilityUpdate();
  });
}

function isDragRepaintSuppressed(): boolean {
  return isItemDragActive() || hasDragLivePositions();
}

function bumpFogRevision(): void {
  useMapStore.setState((s) => ({ fogRevision: s.fogRevision + 1 }));
}

function runFogRepaintListeners(): void {
  if (listeners.size === 0) {
    pendingRepaint = true;
    return;
  }
  pendingRepaint = false;
  for (const listener of listeners) {
    listener();
  }
}

/** Notify Pixi item layers + fog overlays that visibility changed. */
export function requestSceneVisibilityUpdate(): void {
  if (isDragRepaintSuppressed()) {
    deferredFogWork = true;
    return;
  }
  bumpFogRevision();
  runFogRepaintListeners();
}

/** Register an imperative fog repaint (Pixi / Three overlays). */
export function registerFogRepaintListener(listener: FogRepaintListener): () => void {
  listeners.add(listener);
  if (pendingRepaint) {
    pendingRepaint = false;
    queueMicrotask(() => listener());
  } else {
    requestAnimationFrame(() => listener());
  }
  return () => {
    listeners.delete(listener);
  };
}

/** Force all fog overlays to repaint immediately (e.g. after socket sync). */
export function requestFogRepaint(): void {
  if (isDragRepaintSuppressed()) {
    deferredFogWork = true;
    return;
  }
  runFogRepaintListeners();
}

let dragFogRepaintRaf = 0;

/** Repaint fog during token drag — uses dragLivePositions, no store/React churn. */
export function requestFogRepaintDuringDrag(): void {
  runFogRepaintListeners();
}

/** Coalesce drag fog repaints to one per animation frame. */
export function scheduleFogRepaintDuringDrag(): void {
  if (dragFogRepaintRaf) return;
  dragFogRepaintRaf = requestAnimationFrame(() => {
    dragFogRepaintRaf = 0;
    requestFogRepaintDuringDrag();
  });
}

/** Run deferred fog/visibility work after a drag ends. */
export function flushDeferredFogRepaint(): void {
  if (!deferredFogWork) return;
  deferredFogWork = false;
  bumpFogRevision();
  runFogRepaintListeners();
}

/** Repaint when live drags or remote token moves change vision cones. */
export function bindFogRepaintSubscriptions(): void {
  if (subscriptionsBound) return;
  subscriptionsBound = true;

  useLiveTransformStore.subscribe((state, prev) => {
    if (state.tick === prev.tick) return;
    if (!isFogOverlayVisible()) return;
    const vision = visionTokenIds();
    const watch = new Set([...vision, ...lightItemIds()]);
    if (watch.size === 0) return;
    for (const id of watch) {
      const a = state.byId[id];
      const b = prev.byId[id];
      if (!a && !b) continue;
      if (!a || !b) {
        scheduleSceneVisibilityUpdate();
        return;
      }
      if (a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation) {
        scheduleSceneVisibilityUpdate();
        return;
      }
    }
  });

  useItemStore.subscribe((state, prev) => {
    if (state.selectedIds.join(',') !== prev.selectedIds.join(',')) {
      scheduleSceneVisibilityUpdate();
      return;
    }
    if (state.activeMapId !== prev.activeMapId) {
      scheduleSceneVisibilityUpdate();
      return;
    }
    const vision = isFogOverlayVisible() ? visionTokenIds() : new Set<string>();
    for (const id of Object.keys(state.items)) {
      const it = state.items[id];
      const was = prev.items[id];
      if (!it || !was) {
        scheduleSceneVisibilityUpdate();
        return;
      }
      if (
        it.lightOn !== was.lightOn
        || it.lightBrightFt !== was.lightBrightFt
        || it.lightDimFt !== was.lightDimFt
        || it.visible !== was.visible
      ) {
        scheduleSceneVisibilityUpdate();
        return;
      }
      if (it.type !== 'token' && it.type !== 'image') continue;
      if (it.type === 'token' && was.type === 'token' && it.ownerId !== was.ownerId) {
        scheduleSceneVisibilityUpdate();
        return;
      }
      if (it.x === was.x && it.y === was.y && it.rotation === was.rotation) continue;
      if (!isFogOverlayVisible() || itemDrivesFog(it, vision)) {
        scheduleSceneVisibilityUpdate();
        return;
      }
    }
  });

  useMapStore.subscribe((state, prev) => {
    if (
      state.fogEnabled !== prev.fogEnabled
      || state.sessionFogActive !== prev.sessionFogActive
      || state.fogRevision !== prev.fogRevision
    ) {
      requestFogRepaint();
    }
  });
}
