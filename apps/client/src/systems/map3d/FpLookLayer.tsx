import { useEffect, useRef } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useFirstPersonStore } from './firstPersonStore';
import { adjustFirstPersonLook } from './firstPersonLook';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import { syncFirstPersonYaw } from './firstPersonMove';
import { beginFpSpray, endFpSpray } from './fpSurfacePaint';
import { beginFpBreach, endFpBreach } from './fpWallBreach';
import { beginFpErase, endFpErase } from './fpEraseDecals';
import { fpSceneRef } from './fpSceneRef';

const LOOK_YAW_PER_PX = 0.14;
const LOOK_PITCH_PER_PX = 0.0032;
const YAW_SYNC_MS = 160;

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

    const el = ref.current;
    if (!el) return;
    sceneRefs.orbitInteraction.current = el;

    let lmbLook = false;
    let rmbLook = false;
    let lastPointer = { x: 0, y: 0 };
    let yawDirty = false;
    let lastYawSync = 0;
    function applyLook(dx: number, dy: number) {
      if (dx === 0 && dy === 0) return;
      adjustFirstPersonLook(dx * LOOK_YAW_PER_PX, -dy * LOOK_PITCH_PER_PX);
      yawDirty = true;
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
        requestLock();
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.button === 2) {
        rmbLook = true;
        lastPointer = { x: e.clientX, y: e.clientY };
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
    return () => {
      window.clearInterval(syncId);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointermove', onPointerMove);
      el.removeEventListener('contextmenu', onContextMenu);
      if (document.pointerLockElement === el) document.exitPointerLock();
      if (sceneRefs.orbitInteraction.current === el) {
        sceneRefs.orbitInteraction.current = null;
      }
    };
  }, [enabled, viewMode]);

  if (!enabled || viewMode !== '3d') return null;

  return (
    <div
      ref={ref}
      className="absolute inset-0 z-[200] cursor-crosshair"
      style={{ touchAction: 'none' }}
      data-grimoire-fp-look
      aria-label="First person look — click and drag"
    />
  );
}
