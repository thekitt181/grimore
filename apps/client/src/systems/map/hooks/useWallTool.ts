import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { MapItem, WallSegment } from '@/systems/scene/types';

const WALL_COLOR = 0xef4444;
const WALL_STROKE = 3;
const MIN_POINT_DIST = 6;
const MIN_SEGMENT_LEN = 4;

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

function toMapLocal(wx: number, wy: number, map: MapItem) {
  return { x: wx - map.x, y: wy - map.y };
}

function worldPointsToWallSegments(worldPts: number[], map: MapItem): WallSegment[] {
  const segs: WallSegment[] = [];
  for (let i = 0; i < worldPts.length - 2; i += 2) {
    const a = toMapLocal(worldPts[i]!, worldPts[i + 1]!, map);
    const b = toMapLocal(worldPts[i + 2]!, worldPts[i + 3]!, map);
    if (Math.hypot(b.x - a.x, b.y - a.y) < MIN_SEGMENT_LEN) continue;
    segs.push({ a, b });
  }
  return segs;
}

function drawWallPreview(g: Graphics, pts: number[]) {
  g.clear();
  if (pts.length < 4) return;
  g.setStrokeStyle({ width: WALL_STROKE, color: WALL_COLOR, alpha: 0.95 });
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) {
    g.lineTo(pts[i]!, pts[i + 1]!);
  }
  g.stroke();
}

/**
 * GM wall tool — freehand draw LOS walls on the active map.
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

    let drawing = false;
    const pts: number[] = [];

    function toWorld(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - world!.x) / world!.scale.x,
        y: (clientY - rect.top - world!.y) / world!.scale.y,
      };
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
      drawing = true;
      pts.length = 0;
      pts.push(wp.x, wp.y);
      canvas.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (!drawing) return;
      const wp = toWorld(e.clientX, e.clientY);
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      if (
        pts.length >= 2
        && Math.hypot(wp.x - lastX!, wp.y - lastY!) < MIN_POINT_DIST
      ) {
        return;
      }
      pts.push(wp.x, wp.y);
      drawWallPreview(overlay, pts);
    }

    function onUp(e: PointerEvent) {
      if (!drawing) return;
      drawing = false;
      overlay.clear();

      const wp = toWorld(e.clientX, e.clientY);
      const lastX = pts[pts.length - 2];
      const lastY = pts[pts.length - 1];
      if (
        pts.length < 2
        || Math.hypot(wp.x - lastX!, wp.y - lastY!) >= MIN_POINT_DIST
      ) {
        pts.push(wp.x, wp.y);
      }

      if (pts.length < 4) return;

      const map = getActiveMap();
      if (!map) return;

      const newSegs = worldPointsToWallSegments(pts, map);
      if (newSegs.length === 0) return;

      const walls = [...(map.walls ?? []), ...newSegs];
      const patch: Partial<MapItem> = { walls };
      useItemStore.getState().updateItem(map.id, patch);
      emitItemUpdate([{ id: map.id, patch }]);
    }

    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    return () => {
      canvas.style.cursor = 'default';
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      overlay.clear();
    };
  }, [appReady, activeTool]);
}
