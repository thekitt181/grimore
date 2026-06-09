import { useEffect } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { sceneRefs, clientToWorld } from '@/systems/scene/sceneRefs';
import { hitTest } from '@/systems/scene/hitTest';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { previewAttackRange, useCombatStore } from './combatStore';

/** When picking an attack target, clicking a token on the canvas resolves the attack. */
export function useAttackTargetPick(appReady: boolean) {
  const targetPick = useCombatStore((s) => s.targetPick);
  const resolve = useCombatStore((s) => s.resolveAttackAgainstTarget);
  const myRole = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!appReady || !targetPick || myRole !== 'GM') return;
    const app = sceneRefs.app.current;
    if (!app) return;

    const canvas = app.canvas;
    let cursorSaved = false;

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const all = Object.values(useItemStore.getState().items);
      const hit = hitTest(all, wx, wy, { includeLocked: true });
      if (!hit || hit.type !== 'token') return;

      const token = hit as TokenItem;
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
      e.stopPropagation();
      resolve(token.id);
    }

    canvas.style.cursor = 'crosshair';
    cursorSaved = true;
    canvas.addEventListener('pointerdown', onDown, true);

    return () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      if (cursorSaved) canvas.style.cursor = '';
    };
  }, [appReady, targetPick, resolve, myRole]);
}
