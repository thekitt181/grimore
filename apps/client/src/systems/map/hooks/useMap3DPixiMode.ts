import { useEffect } from 'react';
import type { MapViewMode } from '@/systems/map/store/mapStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { fitMapToScreen } from './useMapViewport';
import { clampViewportScale, minViewportScale } from '../viewportLimits';
import { isMobileClient } from '@/lib/socket';

/** Pixi background stays transparent so 3D layers show through; hide item visuals in 3D view only. */
export function useMap3DPixiMode(appReady: boolean, viewMode: MapViewMode) {
  useEffect(() => {
    if (!appReady) return;
    const app = sceneRefs.app.current;
    const world = sceneRefs.world.current;
    if (!app || !world) return;

    const is3d = viewMode === '3d';
    const canvas = app.canvas;

    if (sceneRefs.world.current) {
      sceneRefs.world.current.eventMode = is3d ? 'none' : 'static';
    }

    app.renderer.background.alpha = 0;
    canvas.style.background = 'transparent';

    for (const layer of [
      sceneRefs.fog.current,
      sceneRefs.measure.current,
      sceneRefs.drawPreview.current,
    ]) {
      if (layer) layer.alpha = is3d ? 0 : 1;
    }

    // Items + fog stay visible — 2D tokens render on Pixi in both map modes.
    if (sceneRefs.items.current) {
      sceneRefs.items.current.alpha = 1;
    }
    if (sceneRefs.fog.current) {
      sceneRefs.fog.current.alpha = 1;
    }

    // Transform box/handles are Three.js outlines in 3D; keep other overlay UI (marquee, etc.) visible.
    if (sceneRefs.overlay.current) {
      sceneRefs.overlay.current.alpha = 1;
      for (const child of sceneRefs.overlay.current.children) {
        if (child.label === 'xf-box' || child.label === 'xf-handles') {
          child.visible = !is3d;
        }
      }
    }

    // Entering 3D: fix extreme zoom-out and re-frame if the camera would miss the map.
    if (is3d) {
      const maxScale = isMobileClient() ? 24 : 8;
      const currentScale = world.scale.x;
      if (currentScale < minViewportScale('3d') * 1.001) {
        fitMapToScreen(app, world);
      } else {
        const clamped = clampViewportScale(currentScale, '3d', maxScale);
        if (Math.abs(clamped - currentScale) > 1e-6) {
          const ratio = clamped / currentScale;
          const sw = app.screen.width;
          const sh = app.screen.height;
          world.scale.set(clamped);
          world.x = sw / 2 - (sw / 2 - world.x) * ratio;
          world.y = sh / 2 - (sh / 2 - world.y) * ratio;
          useMapStore.getState().setViewport({ x: world.x, y: world.y, scale: clamped });
        }
      }
    }
  }, [appReady, viewMode]);
}
