import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { MapItem } from '@/systems/scene/types';

/**
 * Grid calibration tool. Drag a rectangle over exactly one printed grid cell of
 * the active map. On release the rectangle size becomes the map's gridSize and
 * its top-left (relative to the map origin) becomes the grid offset.
 */
export function useCalibrateGrid(appReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const overlayRef = useRef<Graphics | null>(null);

  useEffect(() => {
    if (!appReady || activeTool !== 'calibrate') {
      if (overlayRef.current) overlayRef.current.clear();
      return;
    }

    const app   = mapLayerRefs.app.current;
    const world = mapLayerRefs.world.current;
    const prev  = mapLayerRefs.drawPreview.current;
    if (!app || !world || !prev) return;

    const canvas = app.canvas;
    canvas.style.cursor = 'crosshair';

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
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - world!.x) / world!.scale.x,
        y: (clientY - rect.top  - world!.y) / world!.scale.y,
      };
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      const wp = toWorld(e.clientX, e.clientY);
      startWX = wp.x; startWY = wp.y;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
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
      emitItemUpdate([{ id: map.id, patch }]);
      useMapStore.getState().setTool('select');
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup',   onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup',   onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.style.cursor = 'default';
      overlay.clear();
    };
  }, [appReady, activeTool]);
}

function dashRect(g: Graphics, x: number, y: number, w: number, h: number, dash: number, gap: number) {
  const step = dash + gap;
  for (let px = x; px < x + w; px += step) { g.moveTo(px, y); g.lineTo(Math.min(px + dash, x + w), y); }
  for (let py = y; py < y + h; py += step) { g.moveTo(x + w, py); g.lineTo(x + w, Math.min(py + dash, y + h)); }
  for (let px = x + w; px > x; px -= step) { g.moveTo(px, y + h); g.lineTo(Math.max(px - dash, x), y + h); }
  for (let py = y + h; py > y; py -= step) { g.moveTo(x, py); g.lineTo(x, Math.max(py - dash, y)); }
}
