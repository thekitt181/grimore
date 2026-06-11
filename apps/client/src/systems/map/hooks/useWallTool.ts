import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { emitItemUpdate } from '@/systems/scene/sceneSync';
import type { MapItem, WallSegment } from '@/systems/scene/types';
import {
  eraseWallsAtPoint,
  toMapLocal,
  wallsChanged,
  WALL_ERASE_RADIUS,
  worldEllipseToWallSegments,
  worldPointsToWallSegments,
  worldRectToWallSegments,
} from '../wallUtils';

const WALL_COLOR = 0xef4444;
const WALL_STROKE = 3;
const MIN_POINT_DIST = 6;

function drawWallPreview(g: Graphics, pts: number[]) {
  g.clear();
  if (pts.length < 4) return;
  g.setStrokeStyle({ width: WALL_STROKE, color: WALL_COLOR, alpha: 0.95 });
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.stroke();
}

function drawShapePreview(g: Graphics, mode: 'rect' | 'circle', x1: number, y1: number, x2: number, y2: number) {
  g.clear();
  g.setStrokeStyle({ width: WALL_STROKE, color: WALL_COLOR, alpha: 0.95 });
  if (mode === 'rect') {
    g.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else {
    g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  }
  g.stroke();
}

function appendSegments(map: MapItem, segs: WallSegment[]) {
  if (segs.length === 0) return;
  const walls = [...(map.walls ?? []), ...segs];
  const patch: Partial<MapItem> = { walls };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);
}

function eraseAt(map: MapItem, localX: number, localY: number): boolean {
  const walls = map.walls ?? [];
  const next = eraseWallsAtPoint(walls, localX, localY);
  if (!wallsChanged(walls, next)) return false;
  useItemStore.getState().clearWallSelection();
  const patch: Partial<MapItem> = { walls: next };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);
  return true;
}

function drawEraserPreview(g: Graphics, wx: number, wy: number, radius: number) {
  g.clear();
  g.circle(wx, wy, radius);
  g.fill({ color: 0xef4444, alpha: 0.15 });
  g.setStrokeStyle({ width: 1, color: 0xef4444, alpha: 0.85 });
  g.stroke();
}

/**
 * GM wall tool — freehand, rectangle, circle, and eraser sub-modes.
 */
export function useWallTool(appReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const wallMode = useMapStore((s) => s.wallMode);
  const overlayRef = useRef<Graphics | null>(null);

  useEffect(() => {
    if (!appReady || activeTool !== 'wall') {
      overlayRef.current?.clear();
      return;
    }

    const app = mapLayerRefs.app.current;
    const world = mapLayerRefs.world.current;
    const prev = mapLayerRefs.drawPreview.current;
    if (!app || !world || !prev) return;

    const canvas = app.canvas;
    canvas.style.cursor = wallMode === 'eraser' ? 'cell' : 'crosshair';

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
      if (e.button !== 0) return;
      e.preventDefault();
      const wp = toWorld(e.clientX, e.clientY);
      const map = getActiveMap();
      if (!map) return;

      if (wallMode === 'eraser') {
        const local = toMapLocal(wp.x, wp.y, map);
        eraseAt(map, local.x, local.y);
        drawEraserPreview(overlay, wp.x, wp.y, WALL_ERASE_RADIUS);
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      drawing = true;
      pts.length = 0;
      pts.push(wp.x, wp.y);
      canvas.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      const map = getActiveMap();
      if (wallMode === 'eraser') {
        const wp = toWorld(e.clientX, e.clientY);
        drawEraserPreview(overlay, wp.x, wp.y, WALL_ERASE_RADIUS);
        if (e.buttons !== 1 || !map) return;
        const local = toMapLocal(wp.x, wp.y, map);
        eraseAt(map, local.x, local.y);
        return;
      }

      if (!drawing) return;
      const wp = toWorld(e.clientX, e.clientY);
      if (wallMode === 'freehand') {
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        if (pts.length >= 2 && Math.hypot(wp.x - lastX!, wp.y - lastY!) < MIN_POINT_DIST) return;
        pts.push(wp.x, wp.y);
        drawWallPreview(overlay, pts);
      } else {
        drawShapePreview(overlay, wallMode, pts[0]!, pts[1]!, wp.x, wp.y);
      }
    }

    function onUp(e: PointerEvent) {
      if (wallMode === 'eraser') {
        overlay.clear();
        return;
      }

      if (!drawing) return;
      drawing = false;
      overlay.clear();

      const map = getActiveMap();
      if (!map) return;

      const wp = toWorld(e.clientX, e.clientY);

      if (wallMode === 'freehand') {
        const lastX = pts[pts.length - 2];
        const lastY = pts[pts.length - 1];
        if (pts.length < 2 || Math.hypot(wp.x - lastX!, wp.y - lastY!) >= MIN_POINT_DIST) {
          pts.push(wp.x, wp.y);
        }
        if (pts.length < 4) return;
        appendSegments(map, worldPointsToWallSegments(pts, map));
        return;
      }

      if (Math.abs(wp.x - pts[0]!) < 4 && Math.abs(wp.y - pts[1]!) < 4) return;
      const segs = wallMode === 'rect'
        ? worldRectToWallSegments(pts[0]!, pts[1]!, wp.x, wp.y, map)
        : worldEllipseToWallSegments(pts[0]!, pts[1]!, wp.x, wp.y, map);
      appendSegments(map, segs);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      canvas.style.cursor = 'default';
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      overlay.clear();
    };
  }, [appReady, activeTool, wallMode]);
}
