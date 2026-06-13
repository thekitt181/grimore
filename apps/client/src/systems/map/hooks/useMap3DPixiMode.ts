import { useEffect, useLayoutEffect } from 'react';
import type { MapViewMode } from '@/systems/map/store/mapStore';
import { applyPixiViewMode } from '../applyPixiViewMode';

/** Pixi background stays transparent so 3D layers show through; hide item visuals in 3D view only. */
export function useMap3DPixiMode(appReady: boolean, viewMode: MapViewMode) {
  const is3d = viewMode === '3d';

  // Hide Pixi tokens before paint when entering 3D — prevents one frame of 2D zoom then a jump.
  useLayoutEffect(() => {
    if (!appReady) return;
    applyPixiViewMode(is3d);
  }, [appReady, is3d]);

  useEffect(() => {
    if (!appReady) return;
    applyPixiViewMode(is3d);
  }, [appReady, is3d]);
}
