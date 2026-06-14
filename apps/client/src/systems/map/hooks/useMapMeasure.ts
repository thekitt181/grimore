import { useEffect, useRef } from 'react';
import { Graphics, Text, TextStyle, Container } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { clientToWorld, getMapToolElement } from '../mapToolPointer';

/**
 * Multi-waypoint ruler tool (Owlbear-style).
 *
 * - Left-click anywhere on canvas to add a waypoint.
 * - Moving the mouse shows a live preview from the last waypoint to the cursor.
 * - Each segment shows its own distance label.
 * - Double-click OR right-click ends the measurement.
 * - Switching away from the measure tool clears everything.
 */
export function useMapMeasure(
  layerRef: React.RefObject<Container | null>,
  worldRef: React.RefObject<Container | null>,
  interactionReady = false,
) {
  const activeTool = useMapStore((s) => s.activeTool);
  const gridSize   = useMapStore((s) => s.gridSize);

  const waypointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const lineRef   = useRef<Graphics | null>(null);
  const labelsRef = useRef<Text[]>([]);

  function getLine(layer: Container): Graphics {
    if (!lineRef.current) {
      const g = new Graphics();
      g.label = 'measure-line';
      layer.addChild(g);
      lineRef.current = g;
    }
    return lineRef.current;
  }

  function ensureLabel(layer: Container, idx: number): Text {
    while (labelsRef.current.length <= idx) {
      const style = new TextStyle({
        fontFamily: 'Inter, sans-serif', fontSize: 13, fontWeight: 'bold',
        fill: 0xffffff, stroke: { color: 0x000000, width: 4 },
      });
      const t = new Text({ text: '', style });
      layer.addChild(t);
      labelsRef.current.push(t);
    }
    return labelsRef.current[idx]!;
  }

  function clearMeasure(layer: Container) {
    lineRef.current?.clear();
    for (const lbl of labelsRef.current) lbl.text = '';
    waypointsRef.current = [];
  }

  function segmentFeet(ax: number, ay: number, bx: number, by: number): { feet: number; cells: number } {
    const dist  = Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2);
    const cells = dist / gridSize;
    return { feet: Math.round(cells * 5), cells };
  }

  function redraw(layer: Container, cursorX?: number, cursorY?: number) {
    const pts = waypointsRef.current;
    const g   = getLine(layer);
    g.clear();

    const allPts = cursorX !== undefined
      ? [...pts, { x: cursorX, y: cursorY! }]
      : pts;

    if (allPts.length < 2) {
      // Just draw the start dot
      if (allPts.length === 1) {
        g.circle(allPts[0]!.x, allPts[0]!.y, 5);
        g.fill({ color: 0xc9a84c, alpha: 0.9 });
      }
      return;
    }

    let cumulFeet = 0;
    let labelIdx  = 0;

    for (let i = 0; i < allPts.length - 1; i++) {
      const a = allPts[i]!;
      const b = allPts[i + 1]!;
      const { feet, cells } = segmentFeet(a.x, a.y, b.x, b.y);
      cumulFeet += feet;

      const isPreview = cursorX !== undefined && i === allPts.length - 2;

      // Dashed line segment
      drawDashedSegment(g, a.x, a.y, b.x, b.y, isPreview ? 0.5 : 1.0);

      // Endpoint dot
      g.circle(b.x, b.y, 5);
      g.fill({ color: 0xc9a84c, alpha: isPreview ? 0.6 : 1.0 });

      // Segment label
      const lbl = ensureLabel(layer, labelIdx++);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      const segText = i === allPts.length - 2 && pts.length > 0
        ? `${feet}ft (${cells.toFixed(1)}sq)  total: ${cumulFeet}ft`
        : `${feet}ft (${cells.toFixed(1)}sq)`;
      lbl.text   = segText;
      lbl.x      = midX + 8;
      lbl.y      = midY - 16;
      lbl.alpha  = isPreview ? 0.7 : 1.0;
    }

    // Hide unused labels
    for (let i = labelIdx; i < labelsRef.current.length; i++) {
      labelsRef.current[i]!.text = '';
    }

    // Start dot
    g.circle(allPts[0]!.x, allPts[0]!.y, 6);
    g.fill({ color: 0xc9a84c, alpha: 1 });
  }

  function drawDashedSegment(
    g: Graphics, ax: number, ay: number, bx: number, by: number, alpha: number
  ) {
    const dx   = bx - ax, dy = by - ay;
    const len  = Math.sqrt(dx * dx + dy * dy);
    const dash = 10, gap = 6;
    let drawn = 0, isDash = true;

    g.setStrokeStyle({ width: 2, color: 0xc9a84c, alpha });
    while (drawn < len) {
      const seg = Math.min(isDash ? dash : gap, len - drawn);
      const t0 = drawn / len, t1 = (drawn + seg) / len;
      if (isDash) {
        g.moveTo(ax + dx * t0, ay + dy * t0);
        g.lineTo(ax + dx * t1, ay + dy * t1);
      }
      drawn += seg;
      isDash = !isDash;
    }
    g.stroke();
  }

  // ── Enable / disable based on active tool ───────────────────────────────────
  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;

    if (activeTool === 'measure') {
      layer.eventMode = 'static';
      (layer as any).hitArea = { contains: () => true };
      layer.cursor = 'crosshair';
    } else {
      layer.eventMode = 'none';
      clearMeasure(layer);
    }
  }, [activeTool]);

  // ── DOM event handling ──────────────────────────────────────────────────────
  useEffect(() => {
    const app   = mapLayerRefs.app.current;
    const world = worldRef.current;
    const layer = layerRef.current;
    const el = getMapToolElement();
    if (!app || !world || !layer || !el || !interactionReady) return;
    const toolEl = el;
    if (activeTool !== 'measure') return;

    let lastClickTime = 0;

    function toWorld(cx: number, cy: number) {
      return clientToWorld(cx, cy);
    }

    function onDown(e: PointerEvent) {
      if (e.button === 2) { clearMeasure(layer!); return; }
      if (e.button !== 0) return;
      e.stopPropagation();

      const wp  = toWorld(e.clientX, e.clientY);
      const now = Date.now();
      const isDouble = now - lastClickTime < 350;
      lastClickTime = now;

      if (isDouble) {
        // Double-click ends measurement
        clearMeasure(layer!);
        return;
      }

      waypointsRef.current.push(wp);
      redraw(layer!);
    }

    function onMove(e: PointerEvent) {
      if (waypointsRef.current.length === 0) return;
      const wp = toWorld(e.clientX, e.clientY);
      redraw(layer!, wp.x, wp.y);
    }

    function onContextMenu(e: MouseEvent) { e.preventDefault(); }

    toolEl.addEventListener('pointerdown', onDown, true);
    toolEl.addEventListener('pointermove', onMove, true);
    toolEl.addEventListener('contextmenu', onContextMenu);

    return () => {
      toolEl.removeEventListener('pointerdown', onDown, true);
      toolEl.removeEventListener('pointermove', onMove, true);
      toolEl.removeEventListener('contextmenu', onContextMenu);
    };
  }, [activeTool, gridSize, interactionReady]);
}
