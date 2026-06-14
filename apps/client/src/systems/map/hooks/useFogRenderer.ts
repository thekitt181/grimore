import { useEffect } from 'react';
import { useMapStore, cellKey } from '../store/mapStore';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { setFogVisibleForSession } from '@/systems/scene/fogActiveSync';
import { sceneRefs, clientToWorld } from '@/systems/scene/sceneRefs';
import { getMapToolElement } from '../mapToolPointer';

function worldToMapLocal(wx: number, wy: number): { x: number; y: number } {
  const map = getActiveMap();
  if (!map) return { x: wx, y: wy };
  const cx = map.x + map.width / 2;
  const cy = map.y + map.height / 2;
  const rad = (-map.rotation * Math.PI) / 180;
  const dx = wx - cx;
  const dy = wy - cy;
  return {
    x: dx * Math.cos(rad) - dy * Math.sin(rad) + map.width / 2,
    y: dx * Math.sin(rad) + dy * Math.cos(rad) + map.height / 2,
  };
}

/**
 * Fog painting — grid-based GM reveal/hide via canvas pointer events.
 * Rendering lives in useMapFogOverlay (map-attached layer).
 */
export function useFogRenderer(appReady = false, interactionReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const fogBrushSize = useMapStore((s) => s.fogBrushSize);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const applyFogCells = useMapStore((s) => s.applyFogCells);
  const { myRole } = useSessionStore();

  const isGM = myRole === 'GM';
  const isFogTool = activeTool === 'fog-reveal' || activeTool === 'fog-hide';

  useEffect(() => {
    if (!isGM || !isFogTool) return;
    setFogVisibleForSession(true);
  }, [isGM, isFogTool]);

  useEffect(() => {
    if (!appReady || !interactionReady || !isGM || !isFogTool || !fogEnabled) return;
    const app = sceneRefs.app.current;
    const el = getMapToolElement();
    if (!app || !el) return;
    const toolEl = el;

    let painting = false;

    function paint(clientX: number, clientY: number) {
      const map = getActiveMap();
      if (!map) return;
      const cellSize = map.gridSize;
      const { x: wx, y: wy } = clientToWorld(clientX, clientY);
      const { x: localX, y: localY } = worldToMapLocal(wx, wy);
      const cx = Math.floor(localX / cellSize);
      const cy = Math.floor(localY / cellSize);
      const keys: string[] = [];
      for (let dx = -(fogBrushSize - 1); dx < fogBrushSize; dx++) {
        for (let dy = -(fogBrushSize - 1); dy < fogBrushSize; dy++) {
          keys.push(cellKey(cx + dx, cy + dy));
        }
      }
      applyFogCells(keys, activeTool === 'fog-reveal' ? 'reveal' : 'hide');
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.stopPropagation();
      painting = true;
      paint(e.clientX, e.clientY);
      toolEl.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if (!painting) return;
      paint(e.clientX, e.clientY);
    }
    function onUp(e: PointerEvent) {
      if (!painting) return;
      painting = false;
      try { toolEl.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    }

    toolEl.addEventListener('pointerdown', onDown, true);
    toolEl.addEventListener('pointermove', onMove, true);
    toolEl.addEventListener('pointerup', onUp, true);
    toolEl.addEventListener('pointercancel', onUp, true);
    return () => {
      toolEl.removeEventListener('pointerdown', onDown, true);
      toolEl.removeEventListener('pointermove', onMove, true);
      toolEl.removeEventListener('pointerup', onUp, true);
      toolEl.removeEventListener('pointercancel', onUp, true);
    };
  }, [appReady, interactionReady, activeTool, fogBrushSize, isGM, isFogTool, fogEnabled, applyFogCells]);
}
