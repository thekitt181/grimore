import { useEffect, useRef } from 'react';
import { Graphics } from 'pixi.js';
import { v4 as uuidv4 } from 'uuid';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { emitItemAdd } from '@/systems/scene/sceneSync';
import type { DrawItem, TextItem, DrawShape } from '@/systems/scene/types';

import { useSessionStore } from '@/store/sessionStore';
import { DEFAULT_TEXT_FONT_SIZE } from '../drawColors';
import { clientToWorld, getMapToolElement } from '../mapToolPointer';

const DRAW_TOOLS = new Set(['draw-freehand', 'draw-rect', 'draw-circle', 'draw-arrow', 'text']);

// ── Text placement callback — set by DrawingTextInput overlay ────────────────
export interface PendingText { worldX: number; worldY: number; screenX: number; screenY: number; }
let _setPendingText: ((p: PendingText | null) => void) | null = null;
export function registerTextSetter(fn: (p: PendingText | null) => void) { _setPendingText = fn; }

export function commitTextDrawing(worldX: number, worldY: number, text: string) {
  const { drawColor, textFontSize } = useMapStore.getState();
  const myUserId = useSessionStore.getState().myUserId;
  const fontSize = textFontSize || DEFAULT_TEXT_FONT_SIZE;
  const item: TextItem = {
    id: uuidv4(), type: 'text', x: worldX, y: worldY, rotation: 0,
    width: Math.max(40, text.length * fontSize * 0.55), height: fontSize * 1.6,
    zIndex: 0, locked: false, visible: true,
    text, color: drawColor, fontSize,
    ...(myUserId ? { ownerId: myUserId } : {}),
  };
  useItemStore.getState().addItem(item);
  emitItemAdd(item);
}

/**
 * Drawing tools create scene items (DrawItem / TextItem).
 * Preview is rendered in the drawPreview layer while dragging.
 */
export function useDrawingTool(appReady = false, interactionReady = false) {
  const activeTool  = useMapStore((s) => s.activeTool);
  const drawColor   = useMapStore((s) => s.drawColor);
  const drawStroke  = useMapStore((s) => s.drawStroke);

  const previewRef = useRef<Graphics | null>(null);

  useEffect(() => {
    if (!appReady || !interactionReady || !DRAW_TOOLS.has(activeTool)) {
      previewRef.current?.clear();
      return;
    }

    const app   = mapLayerRefs.app.current;
    const world = mapLayerRefs.world.current;
    const prev  = mapLayerRefs.drawPreview.current;
    const el = getMapToolElement();
    if (!app || !world || !prev || !el) return;
    const toolEl = el;

    toolEl.style.cursor = activeTool === 'text' ? 'text' : 'crosshair';

    if (!previewRef.current) {
      const g = new Graphics();
      g.label = 'draw-preview';
      prev.addChild(g);
      previewRef.current = g;
    }
    const preview = previewRef.current;

    let drawing = false;
    const pts: number[] = [];

    function toWorld(cx: number, cy: number) {
      return clientToWorld(cx, cy);
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.stopPropagation();
      if (activeTool === 'text') {
        const wp = toWorld(e.clientX, e.clientY);
        _setPendingText?.({ worldX: wp.x, worldY: wp.y, screenX: e.clientX, screenY: e.clientY });
        return;
      }
      drawing = true;
      pts.length = 0;
      const wp = toWorld(e.clientX, e.clientY);
      pts.push(wp.x, wp.y);
      toolEl.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (!drawing) return;
      const wp = toWorld(e.clientX, e.clientY);
      if (activeTool === 'draw-freehand') {
        pts.push(wp.x, wp.y);
        drawPreviewFreehand(preview, pts, drawColor, drawStroke);
      } else {
        drawPreviewShape(preview, activeTool, pts[0]!, pts[1]!, wp.x, wp.y, drawColor, drawStroke);
      }
    }

    function onUp(e: PointerEvent) {
      if (!drawing) return;
      drawing = false;
      preview.clear();
      const wp = toWorld(e.clientX, e.clientY);
      if (activeTool === 'draw-freehand') {
        pts.push(wp.x, wp.y);
        if (pts.length >= 4) commitDrawing('freehand', [...pts]);
      } else if (activeTool !== 'text') {
        if (Math.abs(wp.x - pts[0]!) > 4 || Math.abs(wp.y - pts[1]!) > 4) {
          const shape = activeTool.replace('draw-', '') as DrawShape;
          commitDrawing(shape, [pts[0]!, pts[1]!, wp.x, wp.y]);
        }
      }
    }

    function commitDrawing(shape: DrawShape, worldPts: number[]) {
      const myUserId = useSessionStore.getState().myUserId;
      // Compute bounding box and convert points to item-local space
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < worldPts.length; i += 2) {
        minX = Math.min(minX, worldPts[i]!); maxX = Math.max(maxX, worldPts[i]!);
        minY = Math.min(minY, worldPts[i + 1]!); maxY = Math.max(maxY, worldPts[i + 1]!);
      }
      const pad = drawStroke;
      minX -= pad; minY -= pad; maxX += pad; maxY += pad;
      const local: number[] = [];
      for (let i = 0; i < worldPts.length; i += 2) {
        local.push(worldPts[i]! - minX, worldPts[i + 1]! - minY);
      }
      const item: DrawItem = {
        id: uuidv4(), type: 'drawing', x: minX, y: minY, rotation: 0,
        width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY),
        zIndex: 0, locked: false, visible: true,
        shape, points: local, color: drawColor, stroke: drawStroke,
        ...(myUserId ? { ownerId: myUserId } : {}),
      };
      useItemStore.getState().addItem(item);
      emitItemAdd(item);
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
      preview.clear();
      _setPendingText?.(null);
    };
  }, [appReady, interactionReady, activeTool, drawColor, drawStroke]);
}

function drawPreviewFreehand(g: Graphics, pts: number[], color: string, stroke: number) {
  g.clear();
  if (pts.length < 4) return;
  const c = parseInt(color.replace('#', ''), 16);
  g.setStrokeStyle({ width: stroke, color: c, alpha: 0.8 });
  g.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length - 1; i += 2) g.lineTo(pts[i]!, pts[i + 1]!);
  g.stroke();
}

function drawPreviewShape(
  g: Graphics, tool: string,
  x1: number, y1: number, x2: number, y2: number,
  color: string, stroke: number
) {
  g.clear();
  const c = parseInt(color.replace('#', ''), 16);
  g.setStrokeStyle({ width: stroke, color: c, alpha: 0.8 });

  if (tool === 'draw-rect') {
    g.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    g.stroke();
  } else if (tool === 'draw-circle') {
    g.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
    g.stroke();
  } else if (tool === 'draw-arrow') {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;
    const ux = dx / len, uy = dy / len;
    const headLen = Math.min(len * 0.3, 20);
    const angle = Math.PI / 6;
    g.moveTo(x1, y1); g.lineTo(x2, y2);
    g.moveTo(x2, y2);
    g.lineTo(x2 - headLen * Math.cos(angle) * ux + headLen * Math.sin(angle) * uy,
             y2 - headLen * Math.cos(angle) * uy - headLen * Math.sin(angle) * ux);
    g.moveTo(x2, y2);
    g.lineTo(x2 - headLen * Math.cos(angle) * ux - headLen * Math.sin(angle) * uy,
             y2 - headLen * Math.cos(angle) * uy + headLen * Math.sin(angle) * ux);
    g.stroke();
  }
}
