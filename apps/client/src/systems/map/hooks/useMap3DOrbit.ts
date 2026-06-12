import { useEffect } from 'react';
import { useMapStore, type MapViewMode } from '../store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';

const AZIMUTH_SENS = 0.005;
const POLAR_SENS = 0.005;

function isOrbitPointer(e: PointerEvent): boolean {
  return e.button === 2;
}

/** Right-drag on the map orbits the 3D camera 360° without blocking token moves. */
export function useMap3DOrbit(appReady: boolean, viewMode: MapViewMode) {
  useEffect(() => {
    if (!appReady || viewMode !== '3d') return;
    const app = sceneRefs.app.current;
    if (!app) return;
    const canvas = app.canvas;

    let orbiting = false;
    let lastX = 0;
    let lastY = 0;

    function onDown(e: PointerEvent) {
      if (!isOrbitPointer(e)) return;
      e.preventDefault();
      orbiting = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    }

    function onMove(e: PointerEvent) {
      if (!orbiting) return;
      e.preventDefault();
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      useMapStore.getState().adjustView3dOrbit(-dx * AZIMUTH_SENS, dy * POLAR_SENS);
    }

    function end(e: PointerEvent) {
      if (!orbiting) return;
      orbiting = false;
      canvas.style.cursor = '';
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', end);
      canvas.removeEventListener('pointercancel', end);
      canvas.style.cursor = '';
    };
  }, [appReady, viewMode]);
}
