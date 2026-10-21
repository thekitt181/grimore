import { useEffect } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import { tryFirstPersonTurn } from './firstPersonMove';
import { firstPersonMotion } from './firstPersonMotion';
import { flushFpPosePersist, tickFpPoseNetwork } from './fpPoseSync';
import { fpGlobal } from './fpGlobals';
import { useTokenDragMeasureStore } from '@/systems/scene/interaction/tokenDragMeasureStore';
import { publishFirstPersonLiveLocal } from './firstPersonMove';
import { cancelFpSpray } from './fpSurfacePaint';
import { cancelFpBreach } from './fpWallBreach';
import { cancelFpErase } from './fpEraseDecals';
import { undoFpPaintAction } from './fpPaintUndo';
import { tryFirstPersonPropInteract } from '@/systems/map/props/fpPropInteract';

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

/** Toolbar / dock — spurious keyup when clicking here while holding WASD. */
function isGameUiFocused(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  return Boolean(
    el.closest(
      'select, input, textarea, button, a, [data-grimoire-map-toolbar], [data-grimoire-session-dock]',
    ),
  );
}

function isGameUiPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      'select, input, textarea, button, a, label, [data-grimoire-map-toolbar], [data-grimoire-session-dock]',
    ),
  );
}

function isMoveKey(key: string): boolean {
  return key === 'w' || key === 'a' || key === 's' || key === 'd'
    || key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright';
}

function clearMoveKeysAndPersist(_reason: string): void {
  const k = firstPersonMotion.held;
  for (const key of [...k]) {
    if (isMoveKey(key)) k.delete(key);
  }
  firstPersonMotion.velX = 0;
  firstPersonMotion.velY = 0;
  flushFpPosePersist();
}

function anyMoveHeld(): boolean {
  const k = firstPersonMotion.held;
  return k.has('w') || k.has('a') || k.has('s') || k.has('d')
    || k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright');
}

const LOCK_KEYUP_GRACE_MS = 280;
/** Delay keyup while a toolbar control has focus — cancels if key repeat still fires. */
const UI_KEYUP_DEFER_MS = 140;

let activePendingMoveKeyUps: Map<string, number> | null = null;

/** After wall/door art selects — keep WASD if keys are still held. */
export function resumeFirstPersonMoveAfterMapFocus(): void {
  activePendingMoveKeyUps?.clear();
  if (anyMoveHeld()) fpGlobal.walkStreaming = true;
}

/** Keyboard + paint undo — mouse look is on {@link FpLookLayer}. */
export function useFirstPersonControls(): void {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const viewMode = useMapStore((s) => s.viewMode);

  useEffect(() => {
    if (!enabled || viewMode !== '3d') return;

    let ignoreMoveKeyupUntil = 0;
    let ignoreMoveKeyupAfterUiUntil = 0;
    const pendingMoveKeyUps = new Map<string, number>();
    activePendingMoveKeyUps = pendingMoveKeyUps;
    let pendingFlushId = 0;

    function onUiPointerDown(e: MouseEvent) {
      if (!isGameUiPointerTarget(e.target)) return;
      ignoreMoveKeyupAfterUiUntil = performance.now() + 220;
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();

      if (key === ' ' || key === 'spacebar') {
        e.preventDefault();
        clearMoveKeysAndPersist('space');
        return;
      }

      if (key === 'escape') {
        cancelFpSpray();
        cancelFpBreach();
        cancelFpErase();
        if (document.pointerLockElement) {
          document.exitPointerLock();
          e.preventDefault();
        }
        clearMoveKeysAndPersist('escape');
        return;
      }

      if ((e.ctrlKey || e.metaKey) && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoFpPaintAction();
        return;
      }

      if (!'wasdqe'.includes(key) && !key.startsWith('arrow')) return;
      if (e.repeat && (key === 'q' || key === 'e')) return;
      e.preventDefault();
      firstPersonMotion.held.add(key);
      if (isMoveKey(key)) {
        pendingMoveKeyUps.delete(key);
        fpGlobal.walkStreaming = true;
        const token = resolveFirstPersonToken();
        if (token) {
          publishFirstPersonLiveLocal(token);
          tickFpPoseNetwork(token, true);
        }
      }
      if (key === 'q') {
        const token = resolveFirstPersonToken();
        if (token) tryFirstPersonTurn(token, -12, true);
      }
      if (key === 'e') {
        if (tryFirstPersonPropInteract()) return;
      }
    }

    function flushPendingMoveKeyUps() {
      const now = performance.now();
      for (const [key, deadline] of pendingMoveKeyUps) {
        if (now < deadline) continue;
        pendingMoveKeyUps.delete(key);
        firstPersonMotion.held.delete(key);
      }
      if (!anyMoveHeld()) {
        firstPersonMotion.velX = 0;
        firstPersonMotion.velY = 0;
        flushFpPosePersist();
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (!isMoveKey(key)) {
        firstPersonMotion.held.delete(key);
        return;
      }
      if (performance.now() < ignoreMoveKeyupUntil) return;
      if (performance.now() < ignoreMoveKeyupAfterUiUntil) return;
      if (isGameUiFocused() || isTypingTarget(e.target)) {
        pendingMoveKeyUps.set(key, performance.now() + UI_KEYUP_DEFER_MS);
        return;
      }
      pendingMoveKeyUps.delete(key);
      firstPersonMotion.held.delete(key);
      if (!anyMoveHeld()) {
        firstPersonMotion.velX = 0;
        firstPersonMotion.velY = 0;
        flushFpPosePersist();
      }
    }

    function onBlur() {
      // Ignore blur when focus moves to toolbar controls inside the same window.
      window.setTimeout(() => {
        if (document.hasFocus() && isGameUiFocused()) return;
        if (!document.hasFocus() && anyMoveHeld()) clearMoveKeysAndPersist('blur');
      }, 0);
    }

    function onPointerLockChange() {
      if (document.pointerLockElement) {
        ignoreMoveKeyupUntil = performance.now() + LOCK_KEYUP_GRACE_MS;
        pendingMoveKeyUps.clear();
        if (anyMoveHeld()) fpGlobal.walkStreaming = true;
      }
      // Esc / unlock frees the cursor only — keep WASD held so walk doesn't hitch.
    }

    pendingFlushId = window.setInterval(flushPendingMoveKeyUps, 40);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousedown', onUiPointerDown, true);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    return () => {
      window.clearInterval(pendingFlushId);
      pendingMoveKeyUps.clear();
      if (activePendingMoveKeyUps === pendingMoveKeyUps) activePendingMoveKeyUps = null;
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousedown', onUiPointerDown, true);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      useTokenDragMeasureStore.getState().clear();
      cancelFpSpray();
      cancelFpBreach();
      cancelFpErase();
      if (document.pointerLockElement) document.exitPointerLock();
      firstPersonMotion.velX = 0;
      firstPersonMotion.velY = 0;
      firstPersonMotion.held.clear();
      flushFpPosePersist();
    };
  }, [enabled, viewMode]);
}