import { useEffect, useRef } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useFirstPersonStore } from './firstPersonStore';
import { accumulateFirstPersonLook } from './firstPersonLook';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import { syncFirstPersonYaw } from './firstPersonMove';
import { beginFpSpray, endFpSpray } from './fpSurfacePaint';
import { beginFpBreach, endFpBreach } from './fpWallBreach';
import { beginFpErase, endFpErase } from './fpEraseDecals';
import { fpSceneRef } from './fpSceneRef';
import { resumeFirstPersonMoveAfterMapFocus } from './useFirstPersonControls';

/** Keep bottom dock / inspector clickable (SessionPage dock is z-30). */
const LOOK_LAYER_BOTTOM = '8.5rem';

function isUiPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'button, a, input, textarea, select, label, [role="button"], [data-grimoire-session-dock], [data-grimoire-map-toolbar]',
    ),
  );
}

function pointInLookRect(el: HTMLElement, clientX: number, clientY: number): boolean {
  const r = el.getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

/** Return keyboard focus to the map so WASD keeps working after toolbar selects. */
function releaseUiFocus() {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }
  resumeFirstPersonMoveAfterMapFocus();
}

const YAW_SYNC_MS = 48;

/**
 * Full-screen look capture above the map (below session dock).
 * Binds directly on this element — avoids canvas / interaction-layer hit-test bugs.
 */
export function FpLookLayer() {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const viewMode = useMapStore((s) => s.viewMode);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled || viewMode !== '3d') {
      sceneRefs.orbitInteraction.current = null;
      return;
    }

    const layer = ref.current;
    if (!layer) return;
    sceneRefs.orbitInteraction.current = layer;
    const el = layer;

    let lmbLook = false;
    let rmbLook = false;
    let lastPointer = { x: 0, y: 0 };
    let yawDirty = false;
    let lastYawSync = 0;
    function applyLook(dx: number, dy: number) {
      if (dx === 0 && dy === 0) return;
      accumulateFirstPersonLook(dx, dy);
      yawDirty = true;
    }

    function syncLayerCaptureStyle(locked: boolean) {
      el.style.pointerEvents = locked ? 'auto' : 'none';
      el.style.cursor = locked ? 'crosshair' : 'default';
      el.style.zIndex = locked ? '200' : '25';
    }

    function requestLock() {
      if (!el || document.pointerLockElement === el) return;
      try {
        void el.requestPointerLock();
      } catch {
        /* blocked — drag look still works */
      }
    }

    function onPointerDown(e: PointerEvent) {
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      if (e.button === 0) {
        const tool = useFirstPersonStore.getState().tool;
        const alreadyLocked = Boolean(document.pointerLockElement);
        if (tool === 'spray' || tool === 'breach' || tool === 'erase') {
          if (!alreadyLocked) {
            requestLock();
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          if (tool === 'spray') beginFpSpray(fpSceneRef.current);
          else if (tool === 'breach') beginFpBreach(fpSceneRef.current);
          else beginFpErase(fpSceneRef.current);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        lmbLook = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        releaseUiFocus();
        requestLock();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.button === 2) {
        rmbLook = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        releaseUiFocus();
        e.preventDefault();
        e.stopPropagation();
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!el) return;
      try {
        if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      if (e.button === 0) {
        lmbLook = false;
        endFpSpray();
        endFpBreach();
        endFpErase();
      }
      if (e.button === 2) rmbLook = false;
    }

    function onPointerMove(e: PointerEvent) {
      if (document.pointerLockElement === el) {
        applyLook(e.movementX, e.movementY);
        e.preventDefault();
        return;
      }
      if (!lmbLook && !rmbLook) return;
      const dx = e.clientX - lastPointer.x;
      const dy = e.clientY - lastPointer.y;
      lastPointer = { x: e.clientX, y: e.clientY };
      if (dx !== 0 || dy !== 0) {
        applyLook(dx, dy);
        e.preventDefault();
      }
    }

    function onContextMenu(e: Event) {
      e.preventDefault();
    }

    function syncPointerLocked() {
      const locked = document.pointerLockElement === el;
      syncLayerCaptureStyle(locked);
      useFirstPersonStore.getState().setLookCaptureActive(locked);
    }

    /** When the cursor is free (Esc), clicks pass through — re-arm look from the map via capture. */
    function onWindowPointerDownCapture(e: PointerEvent) {
      if (document.pointerLockElement === el) return;
      if (isUiPointerTarget(e.target)) return;
      if (!pointInLookRect(el, e.clientX, e.clientY)) return;

      if (e.button === 0) {
        const tool = useFirstPersonStore.getState().tool;
        const alreadyLocked = Boolean(document.pointerLockElement);
        if (tool === 'spray' || tool === 'breach' || tool === 'erase') {
          if (!alreadyLocked) {
            requestLock();
            e.preventDefault();
            return;
          }
          if (tool === 'spray') beginFpSpray(fpSceneRef.current);
          else if (tool === 'breach') beginFpBreach(fpSceneRef.current);
          else beginFpErase(fpSceneRef.current);
          e.preventDefault();
          return;
        }
        lmbLook = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        releaseUiFocus();
        requestLock();
        e.preventDefault();
        return;
      }
      if (e.button === 2) {
        rmbLook = true;
        lastPointer = { x: e.clientX, y: e.clientY };
        releaseUiFocus();
        e.preventDefault();
      }
    }

    function onWindowPointerUpCapture(e: PointerEvent) {
      if (document.pointerLockElement === el) return;
      if (e.button === 0) {
        lmbLook = false;
        endFpSpray();
        endFpBreach();
        endFpErase();
      }
      if (e.button === 2) rmbLook = false;
    }

    function onWindowPointerMoveCapture(e: PointerEvent) {
      if (document.pointerLockElement === el) return;
      if (!lmbLook && !rmbLook) return;
      // Layer has pointer-events:none while unlocked — only window capture drives look.
      if (!pointInLookRect(el, e.clientX, e.clientY)) return;
      const dx = e.clientX - lastPointer.x;
      const dy = e.clientY - lastPointer.y;
      lastPointer = { x: e.clientX, y: e.clientY };
      if (dx !== 0 || dy !== 0) applyLook(dx, dy);
    }

    const syncId = window.setInterval(() => {
      if (!yawDirty) return;
      const now = performance.now();
      if (now - lastYawSync < YAW_SYNC_MS) return;
      lastYawSync = now;
      yawDirty = false;
      const token = resolveFirstPersonToken();
      if (token) syncFirstPersonYaw(token.id);
    }, 50);

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerlockchange', syncPointerLocked);
    window.addEventListener('pointerdown', onWindowPointerDownCapture, true);
    window.addEventListener('pointerup', onWindowPointerUpCapture, true);
    window.addEventListener('pointermove', onWindowPointerMoveCapture, true);
    syncLayerCaptureStyle(false);
    syncPointerLocked();
    return () => {
      window.clearInterval(syncId);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerlockchange', syncPointerLocked);
      window.removeEventListener('pointerdown', onWindowPointerDownCapture, true);
      window.removeEventListener('pointerup', onWindowPointerUpCapture, true);
      window.removeEventListener('pointermove', onWindowPointerMoveCapture, true);
      if (document.pointerLockElement === el) document.exitPointerLock();
      useFirstPersonStore.getState().setLookCaptureActive(false);
      if (sceneRefs.orbitInteraction.current === el) {
        sceneRefs.orbitInteraction.current = null;
      }
    };
  }, [enabled, viewMode]);

  if (!enabled || viewMode !== '3d') return null;

  return (
    <div
      ref={ref}
      className="absolute inset-x-0 top-0 z-[25] cursor-default"
      style={{
        bottom: LOOK_LAYER_BOTTOM,
        touchAction: 'none',
        pointerEvents: 'none',
      }}
      data-grimoire-fp-look
      aria-label="First person look — click map to capture mouse, Esc frees cursor"
    />
  );
}
