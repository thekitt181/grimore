import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';

type FogRepaintListener = () => void;

const listeners = new Set<FogRepaintListener>();
let subscriptionsBound = false;
let pendingRepaint = false;

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
  if (listeners.size === 0) {
    pendingRepaint = true;
    return;
  }
  pendingRepaint = false;
  for (const listener of listeners) {
    listener();
  }
}

/** Repaint when live drags or remote token moves change vision cones. */
export function bindFogRepaintSubscriptions(): void {
  if (subscriptionsBound) return;
  subscriptionsBound = true;

  useLiveTransformStore.subscribe((state, prev) => {
    if (state.tick !== prev.tick) requestFogRepaint();
  });

  useItemStore.subscribe((state, prev) => {
    if (state.selectedIds.join(',') !== prev.selectedIds.join(',')) {
      requestFogRepaint();
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
      ) {
        requestFogRepaint();
        return;
      }
    }
  });
}
