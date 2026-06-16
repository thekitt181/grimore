import { useEffect } from 'react';
import { getMapInteractionEl } from '@/systems/scene/sceneRefs';
import { isPointerOverMapInteraction } from '@/systems/combat/aoePlacementUtils';
import { pickTargetTokenAt } from '@/systems/scene/token/pickInteractableToken';
import { useSpellEffectTargetStore } from './spellEffectTargetStore';
import { finishSpellTargetPick, confirmSingleSpellTarget } from './pickSpellTargets';

const CAPTURE_OPTS = { capture: true, passive: false } as AddEventListenerOptions;

/** Click tokens on the map to select spell targets (single or multi). */
export function useSpellEffectTargetPick(appReady: boolean) {
  const picking = useSpellEffectTargetStore((s) => s.pick !== null);

  useEffect(() => {
    if (!appReady || !picking) return;

    function tokenUnderPointer(clientX: number, clientY: number) {
      if (!isPointerOverMapInteraction(clientX, clientY)) return null;
      const state = useSpellEffectTargetStore.getState().pick;
      if (!state) return null;
      const token = pickTargetTokenAt(clientX, clientY, [state.casterTokenId]);
      if (!token) return null;
      return token;
    }

    function onMove(e: PointerEvent) {
      const token = tokenUnderPointer(e.clientX, e.clientY);
      useSpellEffectTargetStore.getState().setHoverToken(token?.id ?? null);
    }

    function onDown(e: PointerEvent) {
      const token = tokenUnderPointer(e.clientX, e.clientY);
      if (!token) return;

      const state = useSpellEffectTargetStore.getState().pick;
      if (!state) return;

      e.preventDefault();
      e.stopImmediatePropagation();

      if (e.button === 2 && state.allowRepeatTargets) {
        useSpellEffectTargetStore.getState().removeTargetAllocation(token.id);
        return;
      }

      if (e.button !== 0) return;

      if (state.maxTargets === 1 && !state.allowRepeatTargets) {
        confirmSingleSpellTarget(token.id);
        return;
      }

      if (state.allowRepeatTargets) {
        useSpellEffectTargetStore.getState().addTargetAllocation(token.id);
        return;
      }

      useSpellEffectTargetStore.getState().toggleTarget(token.id);
    }

    function onContextMenu(e: MouseEvent) {
      const token = tokenUnderPointer(e.clientX, e.clientY);
      const state = useSpellEffectTargetStore.getState().pick;
      if (!token || !state?.allowRepeatTargets) return;
      e.preventDefault();
      useSpellEffectTargetStore.getState().removeTargetAllocation(token.id);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        finishSpellTargetPick([]);
      }
    }

    const interactionEl = getMapInteractionEl();
    if (interactionEl) {
      interactionEl.style.cursor = 'crosshair';
    }

    window.addEventListener('pointermove', onMove, CAPTURE_OPTS);
    window.addEventListener('pointerdown', onDown, CAPTURE_OPTS);
    window.addEventListener('contextmenu', onContextMenu, CAPTURE_OPTS);
    window.addEventListener('keydown', onKey);

    return () => {
      if (interactionEl) {
        interactionEl.style.cursor = '';
      }
      window.removeEventListener('pointermove', onMove, CAPTURE_OPTS);
      window.removeEventListener('pointerdown', onDown, CAPTURE_OPTS);
      window.removeEventListener('contextmenu', onContextMenu, CAPTURE_OPTS);
      window.removeEventListener('keydown', onKey);
      useSpellEffectTargetStore.getState().setHoverToken(null);
    };
  }, [appReady, picking]);
}
