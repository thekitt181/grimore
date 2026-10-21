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

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
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

/** Keyboard + paint undo — mouse look is on {@link FpLookLayer}. */
export function useFirstPersonControls(): void {
  const enabled = useFirstPersonStore((s) => s.enabled);
  const viewMode = useMapStore((s) => s.viewMode);

  useEffect(() => {
    if (!enabled || viewMode !== '3d') return;

    let ignoreMoveKeyupUntil = 0;

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
        const token = resolveFirstPersonToken();
        if (token) tryFirstPersonTurn(token, 12, true);
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      const key = e.key.toLowerCase();
      if (!isMoveKey(key)) {
        firstPersonMotion.held.delete(key);
        return;
      }
      if (performance.now() < ignoreMoveKeyupUntil) return;
      firstPersonMotion.held.delete(key);
      if (!anyMoveHeld()) {
        firstPersonMotion.velX = 0;
        firstPersonMotion.velY = 0;
        flushFpPosePersist();
      }
    }

    function onBlur() {
      if (anyMoveHeld()) clearMoveKeysAndPersist('blur');
    }

    function onPointerLockChange() {
      if (document.pointerLockElement) {
        ignoreMoveKeyupUntil = performance.now() + LOCK_KEYUP_GRACE_MS;
      } else if (anyMoveHeld()) {
        clearMoveKeysAndPersist('pointer-unlock');
      }
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('pointerlockchange', onPointerLockChange);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
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
