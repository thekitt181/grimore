import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { hasDragLivePositions } from '@/systems/scene/interaction/dragLivePositions';
import { isItemDragActive } from '@/systems/scene/interaction/selectionDragState';

type FogRepaintListener = () => void;

const listeners = new Set<FogRepaintListener>();
let subscriptionsBound = false;
let pendingRepaint = false;
let deferredFogWork = false;

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
    if (state.tick !== prev.tick) requestSceneVisibilityUpdate();
  });

  useItemStore.subscribe((state, prev) => {
    if (state.selectedIds.join(',') !== prev.selectedIds.join(',')) {
      requestSceneVisibilityUpdate();
      return;
    }
    if (state.activeMapId !== prev.activeMapId) {
      requestSceneVisibilityUpdate();
      return;
    }
    for (const id of Object.keys(state.items)) {
      const it = state.items[id];
      const was = prev.items[id];
      if (it?.type !== 'token' || was?.type !== 'token') continue;
      if (
        it.x !== was.x
        || it.y !== was.y
        || it.rotation !== was.rotation
        || it.ownerId !== was.ownerId
        || it.visible !== was.visible
      ) {
        requestSceneVisibilityUpdate();
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
