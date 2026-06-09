import { useEffect, useRef } from 'react';
import { Graphics, Container } from 'pixi.js';
import { sceneRefs, clientToWorld } from '@/systems/scene/sceneRefs';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { itemCenter, type TokenItem } from '@/systems/scene/types';
import { getMapGridSize } from './evaluateAttack';
import {
  buildAoePolygon,
  placementFromCursor,
  tokensInAoe,
} from './aoeGeometry';
import { useCombatStore } from './combatStore';

const FILL = 0xef4444;
const STROKE = 0xfca5a5;
const TOKEN_RING = 0xfca5a5;

function drawPolygon(g: Graphics, poly: { x: number; y: number }[], fillAlpha: number, strokeAlpha: number) {
  if (poly.length < 2) return;
  g.moveTo(poly[0]!.x, poly[0]!.y);
  for (let i = 1; i < poly.length; i++) g.lineTo(poly[i]!.x, poly[i]!.y);
  g.closePath();
  g.fill({ color: FILL, alpha: fillAlpha });
  g.stroke({ width: 2.5, color: STROKE, alpha: strokeAlpha });
}

function drawOrigin(g: Graphics, x: number, y: number) {
  g.circle(x, y, 6);
  g.fill({ color: STROKE, alpha: 0.9 });
  g.circle(x, y, 6);
  g.stroke({ width: 2, color: 0xffffff, alpha: 0.8 });
}

function drawTokenHighlights(g: Graphics, tokens: TokenItem[]) {
  for (const t of tokens) {
    const { cx, cy } = itemCenter(t);
    const r = Math.max(14, Math.min(t.width, t.height) * 0.55);
    g.circle(cx, cy, r);
    g.stroke({ width: 2.5, color: TOKEN_RING, alpha: 0.95 });
  }
}

function ensureGfx(layer: Container, ref: React.MutableRefObject<Graphics | null>, label: string): Graphics {
  if (!ref.current) {
    const g = new Graphics();
    g.label = label;
    layer.addChild(g);
    ref.current = g;
  }
  return ref.current;
}

/** Draw save-effect AoE preview and confirmed shapes on the map overlay. */
export function useAoePlacement(appReady: boolean) {
  const aoePlacement = useCombatStore((s) => s.aoePlacement);
  const aoeDisplay = useCombatStore((s) => s.aoeDisplay);
  const confirm = useCombatStore((s) => s.confirmAoePlacement);
  const cancel = useCombatStore((s) => s.cancelAoePlacement);
  const myRole = useSessionStore((s) => s.myRole);

  const previewGfx = useRef<Graphics | null>(null);
  const displayGfx = useRef<Graphics | null>(null);
  const cursorRef = useRef({ x: 0, y: 0 });

  function redraw() {
    const layer = sceneRefs.overlay.current;
    if (!layer) return;

    const gridSize = getMapGridSize();
    const placing = useCombatStore.getState().aoePlacement;
    const display = useCombatStore.getState().aoeDisplay;
    const tokens = Object.values(useItemStore.getState().items).filter(
      (i): i is TokenItem => i.type === 'token',
    );

    const prev = ensureGfx(layer, previewGfx, 'aoe-preview');
    prev.clear();

    if (placing) {
      const source = useItemStore.getState().items[placing.sourceTokenId];
      if (source?.type === 'token') {
        const { cx, cy } = itemCenter(source);
        const placement = placementFromCursor(
          placing.aoe,
          cx,
          cy,
          cursorRef.current.x,
          cursorRef.current.y,
        );
        const poly = buildAoePolygon(placing.aoe, placement, gridSize);
        drawPolygon(prev, poly, 0.18, 0.75);
        drawOrigin(prev, cx, cy);
        const inArea = tokensInAoe(tokens, placing.aoe, placement, gridSize, placing.sourceTokenId);
        drawTokenHighlights(prev, inArea);
      }
    }

    const disp = ensureGfx(layer, displayGfx, 'aoe-display');
    disp.clear();
    if (display) {
      const poly = buildAoePolygon(display.aoe, display.placement, gridSize);
      drawPolygon(disp, poly, 0.28, 1);
      drawOrigin(disp, display.placement.originX, display.placement.originY);
      const inArea = tokensInAoe(tokens, display.aoe, display.placement, gridSize, display.sourceTokenId);
      drawTokenHighlights(disp, inArea);
    }
  }

  useEffect(() => {
    if (!appReady) return;
    redraw();
  }, [appReady, aoePlacement, aoeDisplay]);

  useEffect(() => {
    if (!aoePlacement) return;
    const source = useItemStore.getState().items[aoePlacement.sourceTokenId];
    if (source?.type === 'token') {
      const { cx, cy } = itemCenter(source);
      cursorRef.current = { x: cx + getMapGridSize() * 3, y: cy };
      redraw();
    }
  }, [aoePlacement]);

  useEffect(() => {
    if (!appReady || !aoePlacement || myRole !== 'GM') return;
    const app = sceneRefs.app.current;
    if (!app) return;

    const canvas = app.canvas;
    canvas.style.cursor = 'crosshair';

    function onMove(e: PointerEvent) {
      cursorRef.current = clientToWorld(e.clientX, e.clientY);
      redraw();
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = clientToWorld(e.clientX, e.clientY);
      confirm(x, y);
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }

    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);

    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      canvas.style.cursor = '';
    };
  }, [appReady, aoePlacement, myRole, confirm, cancel]);

  useEffect(() => {
    if (!appReady) return;
    return () => {
      previewGfx.current?.destroy();
      displayGfx.current?.destroy();
      previewGfx.current = null;
      displayGfx.current = null;
    };
  }, [appReady]);
}
