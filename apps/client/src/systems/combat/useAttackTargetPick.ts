import { useEffect } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { getMapInteractionEl } from '@/systems/scene/sceneRefs';
import { pickTargetTokenAt } from '@/systems/scene/token/pickInteractableToken';
import { previewAttackRange, useCombatStore } from './combatStore';

/** When picking an attack target, clicking a token on the canvas resolves the attack. */
export function useAttackTargetPick(appReady: boolean) {
  const targetPick = useCombatStore((s) => s.targetPick);
  const resolve = useCombatStore((s) => s.resolveAttackAgainstTarget);
  const myRole = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!appReady || !targetPick || myRole !== 'GM') return;
    const interactionEl = getMapInteractionEl();
    if (!interactionEl) return;

    const CAPTURE_OPTS = { capture: true, passive: false } as AddEventListenerOptions;

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const token = pickTargetTokenAt(e.clientX, e.clientY);
      if (!token) return;

      const pick = useCombatStore.getState().targetPick;
      if (!pick || token.id === pick.attackerTokenId) return;

      const preview = previewAttackRange(pick, token);
      if (!preview.inRange) {
        useCombatStore.getState().clearAttackBlocked();
        useCombatStore.setState({
          attackBlocked: {
            message: preview.blockReason ?? 'Out of range',
            targetName: token.name,
          },
        });
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();
      resolve(token.id);
    }

    interactionEl.style.cursor = 'crosshair';
    interactionEl.addEventListener('pointerdown', onDown, CAPTURE_OPTS);

    return () => {
      interactionEl.removeEventListener('pointerdown', onDown, CAPTURE_OPTS);
      interactionEl.style.cursor = '';
    };
  }, [appReady, targetPick, resolve, myRole]);
}
