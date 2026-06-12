import { useEffect } from 'react';
import type { MapViewMode } from '../store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';

const BG_COLOR = 0x0a0a0f;

/** In 3D view, hide Pixi visuals but keep the canvas interactive (select, drag, fog, measure). */
export function useMap3DPixiMode(appReady: boolean, viewMode: MapViewMode) {
  useEffect(() => {
    if (!appReady) return;
    const app = sceneRefs.app.current;
    if (!app) return;

    const is3d = viewMode === '3d';
    const canvas = app.canvas;

    app.renderer.background.alpha = is3d ? 0 : 1;
    if (!is3d) {
      app.renderer.background.color = BG_COLOR;
    }

    canvas.style.background = is3d ? 'transparent' : '';

    for (const layer of [
      sceneRefs.items.current,
      sceneRefs.fog.current,
      sceneRefs.measure.current,
      sceneRefs.drawPreview.current,
    ]) {
      if (layer) layer.alpha = is3d ? 0 : 1;
    }

    // Selection handles, marquee, wall handles stay visible in 3D.
    if (sceneRefs.overlay.current) {
      sceneRefs.overlay.current.alpha = 1;
    }
  }, [appReady, viewMode]);
}
