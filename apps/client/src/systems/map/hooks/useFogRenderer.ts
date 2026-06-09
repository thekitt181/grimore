import { useEffect } from 'react';
import { useMapStore, cellKey } from '../store/mapStore';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { getPersistSessionId } from '@/systems/scene/sessionPersistence';
import { emitFogUpdate } from '@/systems/scene/fogSync';
import { emitFogActive } from '@/systems/scene/fogActiveSync';
import { sceneRefs, clientToWorld } from '@/systems/scene/sceneRefs';

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
export function useFogRenderer(appReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const fogBrushSize = useMapStore((s) => s.fogBrushSize);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const { revealCell, hideCell } = useMapStore();
  const { myRole } = useSessionStore();
  const persistSessionId = getPersistSessionId();

  const isGM = myRole === 'GM';
  const isFogTool = activeTool === 'fog-reveal' || activeTool === 'fog-hide';

  useEffect(() => {
    if (!isGM || !isFogTool) return;
    useMapStore.getState().setSessionFogActive(true);
    useMapStore.getState().setFogEnabled(true);
    emitFogActive(true);
  }, [isGM, isFogTool]);

  useEffect(() => {
    if (!appReady || !isGM || !isFogTool || !fogEnabled) return;
    const app = sceneRefs.app.current;
    if (!app) return;

    const canvas = app.canvas;
    let painting = false;

    function paint(clientX: number, clientY: number) {
      const map = getActiveMap();
      if (!map) return;
      const cellSize = map.gridSize;
      const { x: wx, y: wy } = clientToWorld(clientX, clientY);
      const { x: localX, y: localY } = worldToMapLocal(wx, wy);
      const cx = Math.floor(localX / cellSize);
      const cy = Math.floor(localY / cellSize);
      for (let dx = -(fogBrushSize - 1); dx < fogBrushSize; dx++) {
        for (let dy = -(fogBrushSize - 1); dy < fogBrushSize; dy++) {
          const key = cellKey(cx + dx, cy + dy);
          if (activeTool === 'fog-reveal') revealCell(key);
          else hideCell(key);
        }
      }
      if (persistSessionId) emitFogUpdate();
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      painting = true;
      paint(e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
    }
    function onMove(e: PointerEvent) {
      if (!painting) return;
      paint(e.clientX, e.clientY);
    }
    function onUp(e: PointerEvent) {
      if (!painting) return;
      painting = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [appReady, activeTool, fogBrushSize, isGM, isFogTool, fogEnabled, persistSessionId, revealCell, hideCell]);
}
