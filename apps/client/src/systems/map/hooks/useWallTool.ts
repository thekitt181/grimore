import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { MapItem, WallSegment } from '@/systems/scene/types';

function distToSegment(px: number, py: number, seg: WallSegment): number {
  const { a, b } = seg;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  const cx = a.x + t * dx;
  const cy = a.y + t * dy;
  return Math.hypot(px - cx, py - cy);
}

/**
 * GM wall tool — drag to place LOS segments on the active map.
 * Right-click removes the nearest wall segment.
 */
export function useWallTool(appReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const overlayRef = useRef<Graphics | null>(null);

  useEffect(() => {
    if (!appReady || activeTool !== 'wall') {
      if (overlayRef.current) overlayRef.current.clear();
      return;
    }

    const app = mapLayerRefs.app.current;
    const world = mapLayerRefs.world.current;
    const prev = mapLayerRefs.drawPreview.current;
    if (!app || !world || !prev) return;

    const canvas = app.canvas;
    canvas.style.cursor = 'crosshair';

    if (!overlayRef.current) {
      const g = new Graphics();
      g.label = 'wall-overlay';
      prev.addChild(g);
      overlayRef.current = g;
    }
    const overlay = overlayRef.current;

    let dragging = false;
    let startWX = 0;
    let startWY = 0;

    function toWorld(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - world!.x) / world!.scale.x,
        y: (clientY - rect.top - world!.y) / world!.scale.y,
      };
    }

    function toMapLocal(wx: number, wy: number, map: MapItem) {
      return { x: wx - map.x, y: wy - map.y };
    }

    function onDown(e: PointerEvent) {
      if (e.button === 2) {
        e.preventDefault();
        const map = getActiveMap();
        if (!map) return;
        const wp = toWorld(e.clientX, e.clientY);
        const local = toMapLocal(wp.x, wp.y, map);
        const walls = map.walls ?? [];
        let bestIdx = -1;
        let bestD = 14;
        walls.forEach((seg, i) => {
          const d = distToSegment(local.x, local.y, seg);
          if (d < bestD) { bestD = d; bestIdx = i; }
        });
        if (bestIdx >= 0) {
          const next = walls.filter((_, i) => i !== bestIdx);
          const patch: Partial<MapItem> = { walls: next };
          useItemStore.getState().updateItem(map.id, patch);
          emitItemUpdate([{ id: map.id, patch }]);
        }
        return;
      }
      if (e.button !== 0) return;
      e.preventDefault();
      const wp = toWorld(e.clientX, e.clientY);
      startWX = wp.x;
      startWY = wp.y;
      dragging = true;
      canvas.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (!dragging) return;
      const wp = toWorld(e.clientX, e.clientY);
      overlay.clear();
      overlay.setStrokeStyle({ width: 3, color: 0xef4444, alpha: 0.95 });
      overlay.moveTo(startWX, startWY);
      overlay.lineTo(wp.x, wp.y);
      overlay.stroke();
    }

    function onUp(e: PointerEvent) {
      if (!dragging) return;
      dragging = false;
      overlay.clear();

      const wp = toWorld(e.clientX, e.clientY);
      const len = Math.hypot(wp.x - startWX, wp.y - startWY);
      if (len < 8) return;

      const map = getActiveMap();
      if (!map) return;

      const a = toMapLocal(startWX, startWY, map);
      const b = toMapLocal(wp.x, wp.y, map);
      const seg: WallSegment = { a, b };
      const walls = [...(map.walls ?? []), seg];
      const patch: Partial<MapItem> = { walls };
      useItemStore.getState().updateItem(map.id, patch);
      emitItemUpdate([{ id: map.id, patch }]);
    }

    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.style.cursor = 'default';
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [appReady, activeTool]);
}
