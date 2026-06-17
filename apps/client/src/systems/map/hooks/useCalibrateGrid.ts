import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { Item, MapItem } from '@/systems/scene/types';
import { clientToWorld, getMapToolElement } from '../mapToolPointer';

/**
 * Grid calibration tool. Drag a rectangle over exactly one printed grid cell of
 * the active map. On release the rectangle size becomes the map's gridSize and
 * its top-left (relative to the map origin) becomes the grid offset.
 */
export function useCalibrateGrid(appReady = false, interactionReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const overlayRef = useRef<Graphics | null>(null);

  useEffect(() => {
    if (!appReady || !interactionReady || activeTool !== 'calibrate') {
      if (overlayRef.current) overlayRef.current.clear();
      return;
    }

    const world = mapLayerRefs.world.current;
    const prev  = mapLayerRefs.drawPreview.current;
    const el = getMapToolElement();
    if (!world || !prev || !el) return;
    const toolEl = el;

    toolEl.style.cursor = 'crosshair';

    if (!overlayRef.current) {
      const g = new Graphics();
      g.label = 'calibrate-overlay';
      prev.addChild(g);
      overlayRef.current = g;
    }
    const overlay = overlayRef.current;

    let dragging = false;
    let startWX = 0, startWY = 0;

    function toWorld(clientX: number, clientY: number) {
      return clientToWorld(clientX, clientY);
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const wp = toWorld(e.clientX, e.clientY);
      startWX = wp.x; startWY = wp.y;
      dragging = true;
      toolEl.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (!dragging) return;
      const wp = toWorld(e.clientX, e.clientY);
      const x = Math.min(startWX, wp.x);
      const y = Math.min(startWY, wp.y);
      const w = Math.abs(wp.x - startWX);
      const h = Math.abs(wp.y - startWY);
      overlay.clear();
      if (w < 4 || h < 4) return;
      overlay.setStrokeStyle({ width: 2, color: 0xc9a84c, alpha: 0.9 });
      dashRect(overlay, x, y, w, h, 8, 4);
      overlay.stroke();
      overlay.rect(x, y, w, h);
      overlay.fill({ color: 0xc9a84c, alpha: 0.1 });
    }

    function onUp(e: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      overlay.clear();

      const wp = toWorld(e.clientX, e.clientY);
      const rawW = Math.abs(wp.x - startWX);
      const rawH = Math.abs(wp.y - startWY);
      if (rawW < 8 || rawH < 8) return;

      const map = getActiveMap();
      if (!map) { useMapStore.getState().setTool('select'); return; }

      const newGridSize = Math.round((rawW + rawH) / 2);
      const offX = Math.min(startWX, wp.x) - map.x;
      const offY = Math.min(startWY, wp.y) - map.y;
      const ox = ((offX % newGridSize) + newGridSize) % newGridSize;
      const oy = ((offY % newGridSize) + newGridSize) % newGridSize;

      const patch: Partial<MapItem> = { gridSize: newGridSize, gridOffsetX: ox, gridOffsetY: oy };
      useItemStore.getState().updateItem(map.id, patch);

      // Rescale tokens so each one still occupies sizeCells × 5ft cells on the
      // recalibrated grid (a medium token stays exactly one 5ft square).
      const tokenUpdates: Array<{ id: string; patch: Partial<Item> }> = [];
      if (map.gridSize > 0 && Math.abs(newGridSize - map.gridSize) > 0.5) {
        for (const it of Object.values(useItemStore.getState().items)) {
          if (it.type !== 'token') continue;
          const cells = it.sizeCells || it.width / map.gridSize || 1;
          const newSize = cells * newGridSize;
          const cx = it.x + it.width / 2;
          const cy = it.y + it.height / 2;
          tokenUpdates.push({
            id: it.id,
            patch: {
              width: newSize,
              height: newSize,
              x: cx - newSize / 2,
              y: cy - newSize / 2,
            },
          });
        }
      }
      if (tokenUpdates.length > 0) useItemStore.getState().updateItems(tokenUpdates);

      emitItemUpdate([{ id: map.id, patch }, ...tokenUpdates]);
      useMapStore.getState().setTool('select');
    }

    toolEl.addEventListener('pointerdown', onDown, true);
    toolEl.addEventListener('pointermove', onMove, true);
    toolEl.addEventListener('pointerup',   onUp, true);
    toolEl.addEventListener('pointercancel', onUp, true);

    return () => {
      toolEl.removeEventListener('pointerdown', onDown, true);
      toolEl.removeEventListener('pointermove', onMove, true);
      toolEl.removeEventListener('pointerup',   onUp, true);
      toolEl.removeEventListener('pointercancel', onUp, true);
      toolEl.style.cursor = '';
      overlay.clear();
    };
  }, [appReady, interactionReady, activeTool]);
}

function dashRect(g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number) {
  const step = dash + gap;
  for (let px = x; px < x + w; px += step) { g.moveTo(px, y); g.lineTo(Math.min(px + dash, x + w), y); }
  for (let py = y; py < y + h; py += step) { g.moveTo(x + w, py); g.lineTo(x + w, Math.min(py + dash, y + h)); }
  for (let px = x + w; px > x; px -= step) { g.moveTo(px, y + h); g.lineTo(Math.max(px - dash, x), y + h); }
  for (let py = y + h; py > y; py -= step) { g.moveTo(x, py); g.lineTo(x, Math.max(py - dash, y)); }
}
