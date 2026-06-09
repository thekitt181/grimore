import { useEffect, useRef } from 'react';
import type { Application, Container } from 'pixi.js';
import { isMobileClient } from '@/lib/socket';
import { useMapStore } from '../store/mapStore';

const MIN_SCALE = 0.08;
const MAX_SCALE_DESKTOP = 8;
const MAX_SCALE_MOBILE = 24;
const ZOOM_SPEED = 0.001;

function maxScale(): number {
  return isMobileClient() ? MAX_SCALE_MOBILE : MAX_SCALE_DESKTOP;
}

function clampScale(scale: number): number {
  return Math.max(MIN_SCALE, Math.min(maxScale(), scale));
}

function applyZoomAt(
  world: Container,
  screenX: number,
  screenY: number,
  newScale: number,
  setViewport: (v: { x: number; y: number; scale: number }) => void,
): void {
  const oldScale = world.scale.x;
  const clamped = clampScale(newScale);
  if (clamped === oldScale) return;
  const ratio = clamped / oldScale;
  world.x = screenX - (screenX - world.x) * ratio;
  world.y = screenY - (screenY - world.y) * ratio;
  world.scale.set(clamped);
  setViewport({ x: world.x, y: world.y, scale: clamped });
}

/**
 * Scales + centres the world container so the entire map fits in the viewport.
 * Exported so other hooks (MapCanvas onReady, toolbar button) can call it.
 */
export function fitMapToScreen(app: Application, world: Container) {
  const { mapWidth, mapHeight, mapX, mapY } = useMapStore.getState();
  const scaleX = app.screen.width / mapWidth;
  const scaleY = app.screen.height / mapHeight;
  const scale = Math.min(scaleX, scaleY) * 0.88; // small margin

  world.scale.set(scale);
  world.x = (app.screen.width - mapWidth * scale) / 2 - mapX * scale;
  world.y = (app.screen.height - mapHeight * scale) / 2 - mapY * scale;

  useMapStore.getState().setViewport({ x: world.x, y: world.y, scale });
}

/**
 * Attaches wheel (zoom), pinch (mobile), and pointer (pan) listeners to the canvas.
 */
export function useMapViewport(
  appRef: React.RefObject<Application | null>,
  worldContainerRef: React.RefObject<Container | null>,
  appReady: boolean,
) {
  const setViewport = useMapStore((s) => s.setViewport);
  const activeToolRef = useRef(useMapStore.getState().activeTool);

  useEffect(() => {
    return useMapStore.subscribe((state) => {
      activeToolRef.current = state.activeTool;
    });
  }, []);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });
  const spaceDown = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    const app = appRef.current;
    const world = worldContainerRef.current;
    if (!app || !world) return;
    const w = world;
    const canvas = app.canvas;
    canvas.style.touchAction = 'none';

    function pointerList(): { x: number; y: number }[] {
      return [...pointers.current.values()];
    }

    function pointerDistance(): number {
      const pts = pointerList();
      if (pts.length < 2) return 0;
      return Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
    }

    function pointerMidScreen(): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      const pts = pointerList();
      return {
        x: (pts[0]!.x + pts[1]!.x) / 2 - rect.left,
        y: (pts[0]!.y + pts[1]!.y) / 2 - rect.top,
      };
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space') {
        spaceDown.current = true;
        canvas.style.cursor = 'grab';
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (!isPanning.current) canvas.style.cursor = 'default';
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const delta = -e.deltaY * ZOOM_SPEED;
      const oldScale = w.scale.x;
      applyZoomAt(w, mouseX, mouseY, oldScale + delta * oldScale, setViewport);
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function onPointerDown(e: PointerEvent) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2) {
        isPanning.current = false;
        pinchStart.current = { dist: pointerDistance(), scale: w.scale.x };
        return;
      }

      const isMiddle = e.button === 1;
      const isSpaceLeft = spaceDown.current && e.button === 0;
      const isPanTool = activeToolRef.current === 'pan' && e.button === 0;

      if (!isMiddle && !isSpaceLeft && !isPanTool) return;

      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, vpX: w.x, vpY: w.y };
      canvas.style.cursor = 'grabbing';
      canvas.setPointerCapture(e.pointerId);
    }

    function onPointerMove(e: PointerEvent) {
      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (pointers.current.size >= 2 && pinchStart.current) {
        e.preventDefault();
        const dist = pointerDistance();
        if (dist < 1 || pinchStart.current.dist < 1) return;
        const mid = pointerMidScreen();
        const newScale = pinchStart.current.scale * (dist / pinchStart.current.dist);
        applyZoomAt(w, mid.x, mid.y, newScale, setViewport);
        return;
      }

      if (!isPanning.current) return;
      w.x = panStart.current.vpX + (e.clientX - panStart.current.x);
      w.y = panStart.current.vpY + (e.clientY - panStart.current.y);
      setViewport({ x: w.x, y: w.y, scale: w.scale.x });
    }

    function onPointerUp(e: PointerEvent) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) {
        pinchStart.current = null;
      }

      if (!isPanning.current) return;
      isPanning.current = false;
      canvas.style.cursor = spaceDown.current ? 'grab' : 'default';
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      canvas.style.touchAction = '';
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      pointers.current.clear();
      pinchStart.current = null;
    };
  }, [appRef, worldContainerRef, appReady, setViewport]);
}
