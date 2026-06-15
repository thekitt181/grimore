import type { Container } from 'pixi.js';
import type { MapViewMode } from './store/mapStore';
import { useMapStore } from './store/mapStore';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { pointerHitsToken } from '@/systems/scene/token/tokenPointerPick';
import {
  clampViewportScale,
  maxViewportScale,
  type ViewportScaleContext,
} from './viewportLimits';

/** Tools that own pointer input — map pan/zoom defers to them. */
export function toolOwnsMapPointer(activeTool: string): boolean {
  if (
    activeTool === 'wall'
    || activeTool === 'measure'
    || activeTool === 'calibrate'
    || activeTool === 'eraser'
    || activeTool === 'text'
  ) {
    return true;
  }
  if (activeTool.startsWith('draw-')) return true;
  if (activeTool === 'fog-reveal' || activeTool === 'fog-hide') return true;
  return false;
}

/** Token under cursor blocks 3D navigation; map pick volume is treated as pannable ground. */
export function pointerTargetsToken(clientX: number, clientY: number): boolean {
  return pointerHitsToken(clientX, clientY);
}

export function shouldStartMapPan(
  e: PointerEvent,
  spaceDown: boolean,
  activeTool: string,
  viewMode: MapViewMode,
): boolean {
  if (toolOwnsMapPointer(activeTool)) return false;
  if (e.button === 1) return true;
  if (spaceDown && e.button === 0) return true;
  if (activeTool === 'pan' && e.button === 0) return true;
  // 3D: drag the map/table surface to pan (Shift+drag = marquee in select tool).
  if (viewMode === '3d' && activeTool === 'select' && e.button === 0 && !e.shiftKey) {
    return !pointerTargetsToken(e.clientX, e.clientY);
  }
  return false;
}

export function viewportScaleContext(
  app: { screen: { width: number; height: number } } | null,
): ViewportScaleContext | undefined {
  if (!app) return undefined;
  const map = getActiveMap();
  const { mapWidth, mapHeight } = useMapStore.getState();
  return {
    mapWidth: map?.width ?? mapWidth,
    mapHeight: map?.height ?? mapHeight,
    screenW: app.screen.width,
    screenH: app.screen.height,
  };
}

export function clampMapScale(
  scale: number,
  viewMode: MapViewMode,
  maxScale: number,
  ctx?: ViewportScaleContext,
): number {
  return clampViewportScale(scale, viewMode, maxScale, ctx);
}

export function applyMapZoomAt(
  world: Container,
  screenX: number,
  screenY: number,
  newScale: number,
  maxScale: number,
  setViewport: (v: { x: number; y: number; scale: number }) => void,
  ctx?: ViewportScaleContext,
): boolean {
  const viewMode = useMapStore.getState().viewMode;
  const oldScale = world.scale.x;
  const clamped = clampMapScale(newScale, viewMode, maxScale, ctx);
  if (Math.abs(clamped - oldScale) < 1e-7) return false;
  const ratio = clamped / oldScale;
  world.x = screenX - (screenX - world.x) * ratio;
  world.y = screenY - (screenY - world.y) * ratio;
  world.scale.set(clamped);
  setViewport({ x: world.x, y: world.y, scale: clamped });
  return true;
}
