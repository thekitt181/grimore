import { useEffect, useRef } from 'react';
import type { Application, Container } from 'pixi.js';
import { isMobileClient } from '@/lib/socket';
import { useMapStore } from '../store/mapStore';
import { getPersistSessionId, persistViewportLocal } from '@/systems/scene/sessionPersistence';
import type { MapViewport } from '../store/mapStore';
import { apply3dScreenPan } from '@/systems/map3d/viewportPan';
import { clampViewportScale } from '../viewportLimits';
import { sceneRefs } from '@/systems/scene/sceneRefs';

let viewportPersistTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleViewportPersist(vp: MapViewport): void {
  const sid = getPersistSessionId();
  if (!sid) return;
  if (viewportPersistTimer) clearTimeout(viewportPersistTimer);
  viewportPersistTimer = setTimeout(() => {
    viewportPersistTimer = null;
    persistViewportLocal(sid, vp);
  }, 300);
}

/** Restore a saved pan/zoom onto the Pixi world container. */
export function applyViewport(world: Container, vp: MapViewport): void {
  const viewMode = useMapStore.getState().viewMode;
  const maxScale = isMobileClient() ? MAX_SCALE_MOBILE : MAX_SCALE_DESKTOP;
  let scale = clampViewportScale(vp.scale, viewMode, maxScale);
  let x = vp.x;
  let y = vp.y;

  if (Math.abs(scale - vp.scale) > 1e-7) {
    const app = sceneRefs.app.current;
    if (app) {
      const ratio = scale / vp.scale;
      const sw = app.screen.width;
      const sh = app.screen.height;
      x = sw / 2 - (sw / 2 - vp.x) * ratio;
      y = sh / 2 - (sh / 2 - vp.y) * ratio;
    }
  }

  world.scale.set(scale);
  world.x = x;
  world.y = y;
  useMapStore.getState().setViewport({ x, y, scale });
}

const MAX_SCALE_DESKTOP = 8;
const MAX_SCALE_MOBILE = 24;
const ZOOM_SPEED = 0.001;
const ZOOM_SPEED_3D = 0.0014;

function maxScale(): number {
  return isMobileClient() ? MAX_SCALE_MOBILE : MAX_SCALE_DESKTOP;
}

function clampScale(scale: number): number {
  const viewMode = useMapStore.getState().viewMode;
  return clampViewportScale(scale, viewMode, maxScale());
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
  if (Math.abs(clamped - oldScale) < 1e-7) return;
  const ratio = clamped / oldScale;
  world.x = screenX - (screenX - world.x) * ratio;
  world.y = screenY - (screenY - world.y) * ratio;
  world.scale.set(clamped);
  const vp = { x: world.x, y: world.y, scale: clamped };
  setViewport(vp);
  scheduleViewportPersist(vp);
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

  const vp = { x: world.x, y: world.y, scale };
  useMapStore.getState().setViewport(vp);
  scheduleViewportPersist(vp);
}

/**
 * Attaches wheel (zoom), pinch (mobile), and pointer (pan) listeners to the canvas.
 */
export function useMapViewport(
  appRef: React.RefObject<Application | null>,
  worldContainerRef: React.RefObject<Container | null>,
  appReady: boolean,
  mapAreaRef?: React.RefObject<HTMLElement | null>,
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
    const pixiApp = app;
    const w = world;
    const canvas = pixiApp.canvas;
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

    function isOverMapArea(clientX: number, clientY: number): boolean {
      const area = mapAreaRef?.current ?? canvas;
      const rect = area.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom;
    }

    function onWheel(e: WheelEvent) {
      if (!isOverMapArea(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopPropagation();
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const zoomSpeed = useMapStore.getState().viewMode === '3d' ? ZOOM_SPEED_3D : ZOOM_SPEED;
      const delta = -e.deltaY * zoomSpeed;
      const oldScale = w.scale.x;
      applyZoomAt(w, mouseX, mouseY, oldScale + delta * oldScale, setViewport);
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });

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
      const is3dLeftPan = useMapStore.getState().viewMode === '3d'
        && e.button === 0
        && activeToolRef.current !== 'select';

      if (!isMiddle && !isSpaceLeft && !isPanTool && !is3dLeftPan) return;

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
      const screenDx = e.clientX - panStart.current.x;
      const screenDy = e.clientY - panStart.current.y;
      const { viewMode, view3dOrbit } = useMapStore.getState();
      if (viewMode === '3d') {
        const vp = apply3dScreenPan(
          w,
          pixiApp,
          screenDx,
          screenDy,
          panStart.current.vpX,
          panStart.current.vpY,
          view3dOrbit.azimuth,
        );
        setViewport(vp);
        scheduleViewportPersist(vp);
      } else {
        w.x = panStart.current.vpX + screenDx;
        w.y = panStart.current.vpY + screenDy;
        const vp = { x: w.x, y: w.y, scale: w.scale.x };
        setViewport(vp);
        scheduleViewportPersist(vp);
      }
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
      document.removeEventListener('wheel', onWheel, { capture: true } as AddEventListenerOptions);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      pointers.current.clear();
      pinchStart.current = null;
    };
  }, [appRef, worldContainerRef, appReady, setViewport, mapAreaRef]);
}
