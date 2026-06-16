import { useEffect, useRef } from 'react';
import type { Application, Container } from 'pixi.js';
import { isMobileClient } from '@/lib/socket';
import { useMapStore } from '../store/mapStore';
import { getPersistSessionId, persistViewportLocal } from '@/systems/scene/sessionPersistence';
import type { MapViewport } from '../store/mapStore';
import { apply3dScreenPan, applyScreenPan } from '@/systems/map3d/viewportPan';
import { clientToCanvas, clientDeltaToScreen } from '@/systems/map3d/pixiScreenCoords';
import { clampViewportScale, maxViewportScale, type ViewportScaleContext } from '../viewportLimits';
import { pickHandle } from '@/systems/scene/interaction/useTransformControls';
import {
  applyMapZoomAt,
  pointerTargetsToken,
  shouldStartMapPan,
  viewportScaleContext,
} from '../mapNavigation';
import { isItemDragActive } from '@/systems/scene/interaction/selectionDragState';
import { isAoePlacementActive } from '@/systems/combat/aoePlacementUtils';
import { isSpellTargetPicking } from '@/systems/spells/pickSpellTargets';
import { sceneRefs, getMapInteractionEl } from '@/systems/scene/sceneRefs';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import type { MapItem } from '@/systems/scene/types';

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
  const app = sceneRefs.app.current;
  const ctx = viewportScaleContext(app);
  const maxScale = maxViewportScale(isMobileClient());
  let scale = clampViewportScale(vp.scale, viewMode, maxScale, ctx);
  let x = vp.x;
  let y = vp.y;

  if (Math.abs(scale - vp.scale) > 1e-7 && app) {
    const ratio = scale / vp.scale;
    const sw = app.screen.width;
    const sh = app.screen.height;
    x = sw / 2 - (sw / 2 - vp.x) * ratio;
    y = sh / 2 - (sh / 2 - vp.y) * ratio;
  }

  world.scale.set(scale);
  world.x = x;
  world.y = y;
  useMapStore.getState().setViewport({ x, y, scale });
}

const ZOOM_SPEED = 0.001;
const ZOOM_SPEED_3D = 0.0014;
/** Drag distance before 3D select-mode pan steals the pointer from click-to-select. */
const PAN_DRAG_THRESHOLD = 5;

/** Mirror map item bounds into mapStore before fit/pan (avoids stale grid after sync). */
export function syncMapGridFromItem(map: MapItem): void {
  useMapStore.getState().setActiveGrid({
    gridType: map.gridType,
    gridSize: map.gridSize,
    mapWidth: map.width,
    mapHeight: map.height,
    gridColor: map.gridColor,
    gridOpacity: map.gridOpacity,
    gridOffsetX: map.gridOffsetX,
    gridOffsetY: map.gridOffsetY,
    showGrid: map.showGrid,
    mapX: map.x,
    mapY: map.y,
  });
}

/** Fit viewport to a specific map item (uses item bounds, not stale mapStore). */
export function fitMapItemToScreen(app: Application, world: Container, map: MapItem) {
  syncMapGridFromItem(map);
  const scaleX = app.screen.width / map.width;
  const scaleY = app.screen.height / map.height;
  const scale = Math.min(scaleX, scaleY) * 0.88;

  world.scale.set(scale);
  world.x = (app.screen.width - map.width * scale) / 2 - map.x * scale;
  world.y = (app.screen.height - map.height * scale) / 2 - map.y * scale;

  const vp = { x: world.x, y: world.y, scale };
  useMapStore.getState().setViewport(vp);
  scheduleViewportPersist(vp);
}

/**
 * Scales + centres the world container so the entire map fits in the viewport.
 * Exported so other hooks (MapCanvas onReady, toolbar button) can call it.
 */
export function fitMapToScreen(app: Application, world: Container) {
  const map = getActiveMap();
  if (!map) return;
  fitMapItemToScreen(app, world, map);
}

/**
 * Attaches wheel (zoom), pinch (mobile), and pointer (pan) listeners to the map overlay.
 * Capture phase so navigation wins over selection/transform hooks on the same element.
 */
export function useMapViewport(
  appRef: React.RefObject<Application | null>,
  worldContainerRef: React.RefObject<Container | null>,
  appReady: boolean,
  interactionReady: boolean,
) {
  const setViewport = useMapStore((s) => s.setViewport);
  const activeToolRef = useRef(useMapStore.getState().activeTool);

  useEffect(() => {
    return useMapStore.subscribe((state) => {
      activeToolRef.current = state.activeTool;
    });
  }, []);

  const isPanning = useRef(false);
  const pendingPan = useRef<{ pointerId: number; x: number; y: number; vpX: number; vpY: number } | null>(null);
  const panStart = useRef({ x: 0, y: 0, vpX: 0, vpY: 0 });
  const spaceDown = useRef(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ dist: number; scale: number } | null>(null);

  useEffect(() => {
    const app = appRef.current;
    const world = worldContainerRef.current;
    const mapEl = getMapInteractionEl();
    if (!app || !world || !mapEl || !interactionReady) return;
    const el = mapEl;

    const pixiApp = app;
    const w = world;
    const scaleCtx = (): ViewportScaleContext | undefined => viewportScaleContext(pixiApp);
    const maxScale = () => maxViewportScale(isMobileClient());

    el.style.touchAction = 'none';

    function pointerList(): { x: number; y: number }[] {
      return [...pointers.current.values()];
    }

    function pointerDistance(): number {
      const pts = pointerList();
      if (pts.length < 2) return 0;
      return Math.hypot(pts[1]!.x - pts[0]!.x, pts[1]!.y - pts[0]!.y);
    }

    function pointerMidScreen(): { x: number; y: number } {
      const pts = pointerList();
      const midX = (pts[0]!.x + pts[1]!.x) / 2;
      const midY = (pts[0]!.y + pts[1]!.y) / 2;
      const pt = clientToCanvas(midX, midY);
      return pt ?? { x: pixiApp.screen.width / 2, y: pixiApp.screen.height / 2 };
    }

    function setCursor(cursor: string) {
      el.style.cursor = cursor;
    }

    function persistIfChanged(vp: MapViewport) {
      setViewport(vp);
      scheduleViewportPersist(vp);
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.code !== 'Space' || e.repeat) return;
      spaceDown.current = true;
      setCursor('grab');
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== 'Space') return;
      spaceDown.current = false;
      if (!isPanning.current) setCursor('');
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function isOverMapArea(clientX: number, clientY: number): boolean {
      const rect = el.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom;
    }

    function zoomAtClient(clientX: number, clientY: number, newScale: number) {
      const pt = clientToCanvas(clientX, clientY);
      const mouseX = pt?.x ?? pixiApp.screen.width / 2;
      const mouseY = pt?.y ?? pixiApp.screen.height / 2;
      if (applyMapZoomAt(w, mouseX, mouseY, newScale, maxScale(), setViewport, scaleCtx())) {
        scheduleViewportPersist({ x: w.x, y: w.y, scale: w.scale.x });
      }
    }

    function onWheel(e: WheelEvent) {
      if (!isOverMapArea(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const zoomSpeed = useMapStore.getState().viewMode === '3d' ? ZOOM_SPEED_3D : ZOOM_SPEED;
      const delta = -e.deltaY * zoomSpeed;
      const oldScale = w.scale.x;
      zoomAtClient(e.clientX, e.clientY, oldScale + delta * oldScale);
    }

    function onPointerDown(e: PointerEvent) {
      if (!isOverMapArea(e.clientX, e.clientY)) return;
      if (isAoePlacementActive()) return;
      if (isSpellTargetPicking()) return;

      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pointers.current.size >= 2) {
        isPanning.current = false;
        pinchStart.current = { dist: pointerDistance(), scale: w.scale.x };
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      const mode = useMapStore.getState().viewMode;
      const tool = activeToolRef.current;
      if (!shouldStartMapPan(e, spaceDown.current, tool, mode)) return;
      if (pickHandle(e.clientX, e.clientY)) return;

      const deferForSelect = mode === '3d' && tool === 'select' && !spaceDown.current && !e.shiftKey;
      if (deferForSelect) {
        if (pointerTargetsToken(e.clientX, e.clientY) || isItemDragActive()) return;
        pendingPan.current = {
          pointerId: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          vpX: w.x,
          vpY: w.y,
        };
        return;
      }

      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY, vpX: w.x, vpY: w.y };
      setCursor('grabbing');
      e.preventDefault();
      e.stopImmediatePropagation();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
    }

    function onPointerMove(e: PointerEvent) {
      if (isSpellTargetPicking()) return;
      if (isAoePlacementActive()) return;

      if (pointers.current.has(e.pointerId)) {
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }

      if (pointers.current.size >= 2 && pinchStart.current) {
        e.preventDefault();
        const dist = pointerDistance();
        if (dist < 1 || pinchStart.current.dist < 1) return;
        const mid = pointerMidScreen();
        zoomAtClient(mid.x, mid.y, pinchStart.current.scale * (dist / pinchStart.current.dist));
        return;
      }

      const pending = pendingPan.current;
      if (pending && !isPanning.current && e.pointerId === pending.pointerId) {
        if (isItemDragActive()) {
          pendingPan.current = null;
          return;
        }
        const dx = e.clientX - pending.x;
        const dy = e.clientY - pending.y;
        if (Math.hypot(dx, dy) >= PAN_DRAG_THRESHOLD) {
          isPanning.current = true;
          panStart.current = {
            x: pending.x,
            y: pending.y,
            vpX: pending.vpX,
            vpY: pending.vpY,
          };
          pendingPan.current = null;
          setCursor('grabbing');
          e.preventDefault();
          e.stopImmediatePropagation();
          try {
            el.setPointerCapture(e.pointerId);
          } catch {
            /* ok */
          }
        } else {
          return;
        }
      }

      if (!isPanning.current) return;
      if (isItemDragActive()) {
        isPanning.current = false;
        return;
      }
      e.preventDefault();

      const rawDx = e.clientX - panStart.current.x;
      const rawDy = e.clientY - panStart.current.y;
      const { x: screenDx, y: screenDy } = clientDeltaToScreen(rawDx, rawDy);
      const { viewMode: mode, view3dOrbit } = useMapStore.getState();
      const vp = mode === '3d'
        ? apply3dScreenPan(
            w,
            pixiApp,
            screenDx,
            screenDy,
            panStart.current.vpX,
            panStart.current.vpY,
            view3dOrbit.azimuth,
          )
        : applyScreenPan(
            panStart.current.vpX,
            panStart.current.vpY,
            screenDx,
            screenDy,
            0,
            w.scale.x,
            pixiApp,
          );
      w.x = vp.x;
      w.y = vp.y;
      persistIfChanged(vp);
    }

    function onPointerUp(e: PointerEvent) {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) {
        pinchStart.current = null;
      }

      if (pendingPan.current?.pointerId === e.pointerId) {
        pendingPan.current = null;
      }

      if (!isPanning.current) return;
      isPanning.current = false;
      setCursor(spaceDown.current ? 'grab' : '');
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
    }

    const captureOpts = { passive: false, capture: true } as AddEventListenerOptions;
    el.addEventListener('wheel', onWheel, captureOpts);
    el.addEventListener('pointerdown', onPointerDown, captureOpts);
    el.addEventListener('pointermove', onPointerMove, captureOpts);
    el.addEventListener('pointerup', onPointerUp, captureOpts);
    el.addEventListener('pointercancel', onPointerUp, captureOpts);

    return () => {
      el.style.touchAction = '';
      el.style.cursor = '';
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      el.removeEventListener('wheel', onWheel, captureOpts);
      el.removeEventListener('pointerdown', onPointerDown, captureOpts);
      el.removeEventListener('pointermove', onPointerMove, captureOpts);
      el.removeEventListener('pointerup', onPointerUp, captureOpts);
      el.removeEventListener('pointercancel', onPointerUp, captureOpts);
      pointers.current.clear();
      pinchStart.current = null;
      isPanning.current = false;
      pendingPan.current = null;
    };
  }, [appRef, worldContainerRef, appReady, interactionReady, setViewport]);
}
