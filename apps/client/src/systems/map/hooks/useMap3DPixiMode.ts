import { useEffect, useLayoutEffect } from 'react';
import { useMapStore, type MapViewMode } from '@/systems/map/store/mapStore';
import { applyPixiViewMode } from '../applyPixiViewMode';
import { THREE_READY_EVENT, THREE_UNHEALTHY_EVENT } from '@/systems/map3d/threeCanvasHealth';

/** Pixi background stays transparent so 3D layers show through; hide item visuals in 3D view only. */
export function useMap3DPixiMode(appReady: boolean, viewMode: MapViewMode) {
  const is3d = viewMode === '3d';
  const activeTool = useMapStore((s) => s.activeTool);

  // Hide Pixi tokens before paint when entering 3D — prevents one frame of 2D zoom then a jump.
  useLayoutEffect(() => {
    if (!appReady) return;
    applyPixiViewMode(is3d);
  }, [appReady, is3d, activeTool]);

  useEffect(() => {
    if (!appReady) return;
    applyPixiViewMode(is3d);
  }, [appReady, is3d, activeTool]);

  useEffect(() => {
    if (!appReady) return;
    const sync = () => applyPixiViewMode(useMapStore.getState().viewMode === '3d');
    window.addEventListener(THREE_READY_EVENT, sync);
    window.addEventListener(THREE_UNHEALTHY_EVENT, sync);
    return () => {
      window.removeEventListener(THREE_READY_EVENT, sync);
      window.removeEventListener(THREE_UNHEALTHY_EVENT, sync);
    };
  }, [appReady]);
}
