import { useEffect, useState } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { clientToWorld, getMapToolElement } from '../mapToolPointer';
import { snapPoint } from '@/systems/scene/snap';
import {
  addWanderPathPoint,
  cancelWanderPath,
  finishWanderPath,
  getWanderPathDraft,
  subscribeWanderPathDraft,
  undoWanderPathPoint,
} from '@/systems/map/dungeon/wanderPathDraft';

function drawPath(g: Graphics, pts: Array<{ x: number; y: number }>, cursor?: { x: number; y: number }) {
  g.clear();
  const all = cursor ? [...pts, cursor] : pts;
  if (all.length === 0) return;
  g.setStrokeStyle({ width: 3, color: 0xc9a84c, alpha: cursor ? 0.7 : 0.95 });
  g.moveTo(all[0]!.x, all[0]!.y);
  for (let i = 1; i < all.length; i++) g.lineTo(all[i]!.x, all[i]!.y);
  if (all.length >= 2) g.stroke();
  for (let i = 0; i < all.length; i++) {
    const p = all[i]!;
    const preview = Boolean(cursor && i === all.length - 1);
    g.circle(p.x, p.y, i === 0 ? 7 : 5);
    g.fill({ color: 0xc9a84c, alpha: preview ? 0.55 : 1 });
  }
}

export function useWanderPathTool(appReady: boolean, interactionReady: boolean) {
  const activeTool = useMapStore((s) => s.activeTool);

  useEffect(() => {
    if (activeTool !== 'wander-path' && getWanderPathDraft()) cancelWanderPath();
  }, [activeTool]);

  useEffect(() => {
    const layer = sceneRefs.overlay.current ?? sceneRefs.measure.current;
    const el = getMapToolElement();
    if (!appReady || !interactionReady || !layer || !el) return;
    if (activeTool !== 'wander-path') return;

    const g = new Graphics();
    g.label = 'wander-path-preview';
    layer.addChild(g);
    let cursor: { x: number; y: number } | null = null;
    let lastClick = 0;

    function redraw() {
      const d = getWanderPathDraft();
      drawPath(g, d?.points ?? [], cursor ?? undefined);
    }

    const unsub = subscribeWanderPathDraft(redraw);
    redraw();

    function toWorld(cx: number, cy: number) {
      const raw = clientToWorld(cx, cy);
      return snapPoint(raw.x, raw.y);
    }

    function onDown(e: PointerEvent) {
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        cancelWanderPath();
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const now = Date.now();
      const dbl = now - lastClick < 350;
      lastClick = now;
      if (dbl) {
        finishWanderPath();
        return;
      }
      addWanderPathPoint(toWorld(e.clientX, e.clientY));
    }

    function onMove(e: PointerEvent) {
      cursor = toWorld(e.clientX, e.clientY);
      redraw();
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cancelWanderPath();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        finishWanderPath();
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        undoWanderPathPoint();
      }
    }

    function onContext(e: MouseEvent) {
      e.preventDefault();
    }

    el.addEventListener('pointerdown', onDown, true);
    el.addEventListener('pointermove', onMove, true);
    el.addEventListener('contextmenu', onContext);
    window.addEventListener('keydown', onKey, true);

    return () => {
      unsub();
      g.destroy();
      el.removeEventListener('pointerdown', onDown, true);
      el.removeEventListener('pointermove', onMove, true);
      el.removeEventListener('contextmenu', onContext);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [activeTool, appReady, interactionReady]);
}

export function WanderPathHud() {
  const [draft, setDraft] = useState(getWanderPathDraft());
  useEffect(() => subscribeWanderPathDraft(() => setDraft(getWanderPathDraft())), []);
  if (!draft) return null;
  return (
    <div className="pointer-events-auto absolute bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-[#c9a84c88] bg-[#12121ae8] px-3 py-2 font-ui text-[12px] text-[#e8e0d0] shadow-panel">
      <p className="whitespace-nowrap">
        Click to set path ({draft.points.length} point{draft.points.length === 1 ? '' : 's'})
        {' · '}Enter or double-click to save · Esc to cancel
      </p>
      <div className="mt-1.5 flex justify-center gap-2">
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => undoWanderPathPoint()}>
          Undo
        </button>
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => finishWanderPath()}>
          Save path
        </button>
        <button type="button" className="btn-ghost px-2 py-0.5 text-xs" onClick={() => cancelWanderPath()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
