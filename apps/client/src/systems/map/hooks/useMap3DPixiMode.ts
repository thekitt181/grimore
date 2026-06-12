import { useEffect } from 'react';
import type { MapViewMode } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';

/** Pixi background stays transparent so 3D layers show through; hide item visuals in 3D view only. */
export function useMap3DPixiMode(appReady: boolean, viewMode: MapViewMode) {
  useEffect(() => {
    if (!appReady) return;
    const app = sceneRefs.app.current;
    if (!app) return;

    const is3d = viewMode === '3d';
    const canvas = app.canvas;

    app.renderer.background.alpha = 0;
    canvas.style.background = 'transparent';

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
