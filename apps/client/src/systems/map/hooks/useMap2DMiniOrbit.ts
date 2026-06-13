import { useEffect, useRef } from 'react';
import { useMapStore, type MapViewMode } from '../store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { sceneRefs, getMapInteractionEl } from '@/systems/scene/sceneRefs';

const AZIMUTH_SENS = 0.004;
const ORBIT_DRAG_PX = 3;

function isOrbitPointer(e: PointerEvent): boolean {
  return e.button === 2;
}

function selectedModelTokenId(): string | null {
  const { viewMode, activeTool } = useMapStore.getState();
  if (viewMode !== '2d' || activeTool !== 'select') return null;

  const selectedIds = useItemStore.getState().selectedIds;
  if (selectedIds.length !== 1) return null;

  const item = useItemStore.getState().items[selectedIds[0]!];
  if (item?.type !== 'token' || !item.modelUrl) return null;
  return selectedIds[0]!;
}

/** Right-drag with a GLB mini selected orbits the 2D overlay camera (shape stays intact). */
export function useMap2DMiniOrbit(appReady: boolean, viewMode: MapViewMode, interactionReady = false) {
  const selectedKey = useItemStore((s) =>
    s.selectedIds.length === 1 ? s.selectedIds[0]! : '',
  );
  const activeTool = useMapStore((s) => s.activeTool);
  const prevTokenRef = useRef<string | null>(null);

  // Save/load per token — never reset orbit when clicking off (view stays put).
  useEffect(() => {
    const tokenId = selectedModelTokenId();
    const prev = prevTokenRef.current;
    const store = useMapStore.getState();

    if (prev && prev !== tokenId) {
      store.saveMiniOrbitForToken(prev, store.view2dMiniOrbit.azimuth);
    }

    if (tokenId && tokenId !== prev) {
      store.setView2dMiniOrbitAzimuth(store.getMiniOrbitForToken(tokenId));
    }

    prevTokenRef.current = tokenId;
  }, [selectedKey, viewMode, activeTool]);

  useEffect(() => {
    if (!appReady || !interactionReady || viewMode !== '2d') return;
    const app = sceneRefs.app.current;
    if (!app) return;
    const canvas = getMapInteractionEl() ?? app.canvas;

    let orbiting = false;
    let orbitDragged = false;
    let lastX = 0;
    let suppressContextMenu = false;

    function onDown(e: PointerEvent) {
      if (!isOrbitPointer(e) || !selectedModelTokenId()) return;
      e.preventDefault();
      e.stopPropagation();
      orbiting = true;
      orbitDragged = false;
      suppressContextMenu = false;
      lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grab';
    }

    function onMove(e: PointerEvent) {
      if (!orbiting) return;
      e.preventDefault();
      const dx = e.clientX - lastX;
      if (Math.abs(dx) >= ORBIT_DRAG_PX) orbitDragged = true;
      lastX = e.clientX;
      const tokenId = selectedModelTokenId();
      useMapStore.getState().adjustView2dMiniOrbit(-dx * AZIMUTH_SENS, tokenId ?? undefined);
    }

    function onContextMenu(e: Event) {
      if (!suppressContextMenu && !orbitDragged) return;
      e.preventDefault();
      e.stopPropagation();
      suppressContextMenu = false;
      orbitDragged = false;
    }

    function end(e: PointerEvent) {
      if (!orbiting) return;
      orbiting = false;
      canvas.style.cursor = '';
      if (orbitDragged) {
        suppressContextMenu = true;
        e.preventDefault();
        e.stopPropagation();
      }
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ok */
      }
      window.setTimeout(() => {
        suppressContextMenu = false;
      }, 250);
    }

    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove, true);
    canvas.addEventListener('pointerup', end, true);
    canvas.addEventListener('pointercancel', end, true);
    canvas.addEventListener('contextmenu', onContextMenu, true);

    return () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove, true);
      canvas.removeEventListener('pointerup', end, true);
      canvas.removeEventListener('pointercancel', end, true);
      canvas.removeEventListener('contextmenu', onContextMenu, true);
      canvas.style.cursor = '';
    };
  }, [appReady, interactionReady, viewMode]);
}
