import { useEffect, useRef } from 'react';
import { useMapStore } from '../store/mapStore';
import { getMapToolElement } from '../mapToolPointer';
import { pointerToMapWorld } from '@/systems/map3d/screenToGround';
import { emitMapPing } from '../mapPingSync';
import { useMapPingStore } from '../mapPingStore';

const CLICK_SLOP_PX = 8;
const CAPTURE = { capture: true, passive: false } as AddEventListenerOptions;

function overMap(el: HTMLElement, e: PointerEvent): boolean {
  const t = e.target;
  if (t instanceof Node && el.contains(t)) return true;
  const r = el.getBoundingClientRect();
  return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
}

function typingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}

function lookHereFromEvent(e: PointerEvent): boolean {
  return e.shiftKey || useMapPingStore.getState().lookHereDefault;
}

/** Ping tool click, or hold G and click, so everyone sees a pulse on the table. */
export function useMapPingTool(appReady: boolean, interactionReady: boolean): void {
  const activeTool = useMapStore((s) => s.activeTool);
  const downRef = useRef<{ x: number; y: number; pointerId: number } | null>(null);
  const gHeld = useRef(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (typingTarget(e.target)) return;
      if (e.key === 'g' || e.key === 'G') gHeld.current = true;
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.key === 'g' || e.key === 'G') gHeld.current = false;
    }
    function onBlur() {
      gHeld.current = false;
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      gHeld.current = false;
    };
  }, []);

  useEffect(() => {
    if (!appReady || !interactionReady) return;
    const el = getMapToolElement();
    if (!el) return;
    const mapEl = el;
    const pingTool = activeTool === 'ping';
    if (pingTool) mapEl.style.cursor = 'crosshair';

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      if (!overMap(mapEl, e)) return;
      if (!pingTool && !gHeld.current) return;
      downRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      e.preventDefault();
      e.stopImmediatePropagation();
    }

    function onUp(e: PointerEvent) {
      const down = downRef.current;
      downRef.current = null;
      if (!down || e.pointerId !== down.pointerId) return;
      if (!overMap(mapEl, e)) return;
      if (!pingTool && !gHeld.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > CLICK_SLOP_PX) return;
      const { x, y } = pointerToMapWorld(e.clientX, e.clientY);
      emitMapPing(x, y, lookHereFromEvent(e));
    }

    function onCancel() {
      downRef.current = null;
    }

    window.addEventListener('pointerdown', onDown, CAPTURE);
    window.addEventListener('pointerup', onUp, CAPTURE);
    window.addEventListener('pointercancel', onCancel, CAPTURE);
    return () => {
      if (pingTool) mapEl.style.cursor = '';
      window.removeEventListener('pointerdown', onDown, CAPTURE);
      window.removeEventListener('pointerup', onUp, CAPTURE);
      window.removeEventListener('pointercancel', onCancel, CAPTURE);
    };
  }, [appReady, interactionReady, activeTool]);
}
