import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { getMapToolElement } from '../mapToolPointer';
import { pickTargetTokenAt } from '@/systems/scene/token/pickInteractableToken';

const CLICK_SLOP_PX = 8;
const CAPTURE = { capture: true, passive: false } as AddEventListenerOptions;

function overMap(el: HTMLElement, e: PointerEvent): boolean {
  const t = e.target;
  if (t instanceof Node && el.contains(t)) return true;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

/** Click tokens to measure them — swallow the event so nothing starts a drag. */
export function useCheckDistanceTool(appReady: boolean, interactionReady: boolean): void {
  const activeTool = useMapStore((s) => s.activeTool);
  const downRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);

  useEffect(() => {
    if (!appReady || !interactionReady || activeTool !== 'check-distance') return;
    const el = getMapToolElement();
    if (!el) return;

    el.style.cursor = 'crosshair';

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      if (!overMap(el, e)) return;
      downRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function onUp(e: PointerEvent) {
      const down = downRef.current;
      downRef.current = null;
      if (!down || e.pointerId !== down.pointerId) return;
      if (!overMap(el, e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;

      const token = pickTargetTokenAt(e.clientX, e.clientY);
      if (!token) return;
      useMapStore.getState().setCheckDistanceFrom(token.id);
    }

    function onCancel() {
      downRef.current = null;
    }

    // Window capture runs before the select/move listeners on the map overlay.
    window.addEventListener('pointerdown', onDown, CAPTURE);
    window.addEventListener('pointerup', onUp, CAPTURE);
    window.addEventListener('pointercancel', onCancel, CAPTURE);
    return () => {
      el.style.cursor = '';
      window.removeEventListener('pointerdown', onDown, CAPTURE);
      window.removeEventListener('pointerup', onUp, CAPTURE);
      window.removeEventListener('pointercancel', onCancel, CAPTURE);
    };
  }, [appReady, interactionReady, activeTool]);
}
