import { useEffect, useRef } from 'react';
import { useMapStore, type MapViewMode } from '../store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { sceneRefs, getOrbitInteractionEl } from '@/systems/scene/sceneRefs';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';

const AZIMUTH_SENS = 0.005;
const POLAR_SENS = 0.005;
const ORBIT_DRAG_PX = 3;

function isOrbitPointer(e: PointerEvent): boolean {
  return e.button === 2;
}

function selectedOrbitTokenId(): string | null {
  const { viewMode, activeTool } = useMapStore.getState();
  if (viewMode !== '3d' || activeTool !== 'select') return null;

  const selectedIds = useItemStore.getState().selectedIds;
  if (selectedIds.length !== 1) return null;

  const item = useItemStore.getState().items[selectedIds[0]!];
  if (item?.type !== 'token') return null;
  return selectedIds[0]!;
}

/** Right-drag in 3D view orbits the camera; per-token view is saved on deselect. */
export function useMap3DOrbit(appReady: boolean, viewMode: MapViewMode, interactionReady = false) {
  const selectedKey = useItemStore((s) =>
    s.selectedIds.length === 1 ? s.selectedIds[0]! : '',
  );
  const activeTool = useMapStore((s) => s.activeTool);
  const gm2dEditorOpen = useMapStore((s) => s.gm2dEditorOpen);
  const mapFrozen = useMapStore((s) => s.mapFrozen);
  const firstPerson = useFirstPersonStore((s) => s.enabled);
  const prevTokenRef = useRef<string | null>(null);

  useEffect(() => {
    // Side 2D editor: never retarget the left 3D camera when selecting/placing tokens.
    if (useMapStore.getState().gm2dEditorOpen) {
      prevTokenRef.current = null;
      return;
    }

    const tokenId = selectedOrbitTokenId();
    const prev = prevTokenRef.current;
    const store = useMapStore.getState();

    if (prev && prev !== tokenId) {
      store.saveMiniOrbit3dForToken(prev, store.view3dOrbit);
    }

    if (tokenId && tokenId !== prev) {
      store.setView3dOrbit(store.getMiniOrbit3dForToken(tokenId));
    }

    prevTokenRef.current = tokenId;
  }, [selectedKey, viewMode, activeTool, gm2dEditorOpen]);

  useEffect(() => {
    if (!appReady || !interactionReady || viewMode !== '3d' || firstPerson || mapFrozen) return;
    const app = sceneRefs.app.current;
    if (!app) return;
    const canvas = getOrbitInteractionEl() ?? app.canvas;

    let orbiting = false;
    let orbitDragged = false;
    let lastX = 0;
    let lastY = 0;
    let suppressContextMenu = false;

    function onDown(e: PointerEvent) {
      if (!isOrbitPointer(e)) return;
      e.preventDefault();
      e.stopPropagation();
      orbiting = true;
      orbitDragged = false;
      suppressContextMenu = false;
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
      if (Math.abs(dx) >= ORBIT_DRAG_PX || Math.abs(dy) >= ORBIT_DRAG_PX) {
        orbitDragged = true;
      }
      lastX = e.clientX;
      lastY = e.clientY;
      const store = useMapStore.getState();
      const tokenId = store.gm2dEditorOpen ? null : selectedOrbitTokenId();
      store.adjustView3dOrbit(
        -dx * AZIMUTH_SENS,
        dy * POLAR_SENS,
        tokenId ?? undefined,
      );
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
  }, [appReady, interactionReady, viewMode, gm2dEditorOpen, firstPerson, mapFrozen]);
}
