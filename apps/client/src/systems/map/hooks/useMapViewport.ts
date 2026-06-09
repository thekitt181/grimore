import { useEffect, useRef } from 'react';
import type { Application, Container } from 'pixi.js';
import { useMapStore } from '../store/mapStore';

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
  // Centre the active map (which may not be at world origin)
  world.x = (app.screen.width  - mapWidth  * scale) / 2 - mapX * scale;
  world.y = (app.screen.height - mapHeight * scale) / 2 - mapY * scale;

  useMapStore.getState().setViewport({ x: world.x, y: world.y, scale });
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_SPEED = 0.001;

/**
 * Attaches wheel (zoom) and pointer (pan) event listeners to the PixiJS canvas.
 *
 * Pan triggers:
 *  - Middle mouse drag (always)
 *  - Space + left drag (always)
 *  - Left drag when pan tool is active
 * Zoom: scroll wheel centred on cursor
 */
export function useMapViewport(
  appRef: React.RefObject<Application | null>,
  worldContainerRef: React.RefObject<Container | null>,
  appReady: boolean
) {
  const setViewport = useMapStore((s) => s.setViewport);
  // Read activeTool via a ref so event handlers always see the latest value
  const activeToolRef = useRef(useMapStore.getState().activeTool);

  // Keep the ref in sync whenever the tool changes
  useEffect(() => {
    return useMapStore.subscribe((state) => {
      activeToolRef.current = state.activeTool;
    });
  }, []);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });
  const spaceDown = useRef(false);

  useEffect(() => {
    const app = appRef.current;
    const world = worldContainerRef.current;
    if (!app || !world) return;
    const w = world;
    const canvas = app.canvas;

    // ── Keyboard: track space bar ──────────────────────────────────────────
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

    // ── Scroll: zoom centred on cursor ─────────────────────────────────────
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const delta = -e.deltaY * ZOOM_SPEED;
      const oldScale = w.scale.x;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale + delta * oldScale));
      const ratio = newScale / oldScale;

      w.x = mouseX - (mouseX - w.x) * ratio;
      w.y = mouseY - (mouseY - w.y) * ratio;
      w.scale.set(newScale);
      setViewport({ x: w.x, y: w.y, scale: newScale });
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    // ── Pointer: pan ───────────────────────────────────────────────────────
    function onPointerDown(e: PointerEvent) {
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
      if (!isPanning.current) return;
      w.x = panStart.current.vpX + (e.clientX - panStart.current.x);
      w.y = panStart.current.vpY + (e.clientY - panStart.current.y);
      setViewport({ x: w.x, y: w.y, scale: w.scale.x });
    }

    function onPointerUp() {
      if (!isPanning.current) return;
      isPanning.current = false;
      canvas.style.cursor = spaceDown.current ? 'grab' : 'default';
    }

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
    };
  }, [appRef, worldContainerRef, appReady]);
}
