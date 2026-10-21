import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore, clampView3dOrbit } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { resetSessionMapView } from '@/systems/map/mapFocusSync';
import { clampViewportScale, maxViewportScale } from '@/systems/map/viewportLimits';
import { viewportScaleContext } from '@/systems/map/mapNavigation';
import { isMobileClient } from '@/lib/socket';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { GM_2D_EDITOR_PANE_WIDTH } from './gm2dEditorLayout';
import type { TokenItem } from '@/systems/scene/types';

const btn = 'btn-ghost text-xs px-2 py-1 rounded border border-[var(--color-border-gold)]';
const btnDisabled = `${btn} opacity-40 cursor-not-allowed`;

function zoomBy(factor: number) {
  const store = useMapStore.getState();
  const world = sceneRefs.world.current;
  const app = sceneRefs.app.current;
  if (!world || !app) return;
  // Always zoom the shared Pixi viewport — left 3D + right editor underlay both follow it.
  const sw = app.screen.width;
  const sh = app.screen.height;
  const viewMode = store.viewMode;
  const ctx = viewportScaleContext(app);
  const oldScale = world.scale.x;
  const newScale = clampViewportScale(oldScale * factor, viewMode, maxViewportScale(isMobileClient()), ctx);
  if (Math.abs(newScale - oldScale) < 1e-7) return;
  const ratio = newScale / oldScale;
  world.x = sw / 2 - (sw / 2 - world.x) * ratio;
  world.y = sh / 2 - (sh / 2 - world.y) * ratio;
  world.scale.set(newScale);
  store.setViewport({ x: world.x, y: world.y, scale: newScale });
}

/** Selected token when exactly one token is selected. */
export function selectedOrbitToken(): TokenItem | null {
  const { selectedIds, items } = useItemStore.getState();
  if (selectedIds.length !== 1) return null;
  const item = items[selectedIds[0]!];
  return item?.type === 'token' ? item : null;
}

/**
 * Pan to the selected token and set 3D orbit so the camera looks the way it faces
 * (camera sits behind the mini). Keeps current tilt.
 */
export function centerViewOnSelectedToken(): boolean {
  const store = useMapStore.getState();
  if (store.viewMode !== '3d') return false;
  const token = selectedOrbitToken();
  if (!token) return false;

  const world = sceneRefs.world.current;
  const app = sceneRefs.app.current;
  if (!world || !app) return false;

  const sw = app.screen.width;
  const sh = app.screen.height;
  const scale = world.scale.x;
  const cx = token.x + token.width / 2;
  const cy = token.y + token.height / 2;
  world.x = sw / 2 - cx * scale;
  world.y = sh / 2 - cy * scale;
  store.setViewport({ x: world.x, y: world.y, scale });

  // Orbit azimuth 0 = camera on +Z looking −Z (north). Token rotation 0° faces north
  // (yawForwardWorld), so azimuth = −rotation puts the camera behind the token.
  const azimuth = -((token.rotation * Math.PI) / 180);
  const orbit = clampView3dOrbit({
    azimuth,
    polar: store.view3dOrbit.polar,
  });
  store.setView3dOrbit(orbit);
  if (!store.gm2dEditorOpen) {
    store.saveMiniOrbit3dForToken(token.id, orbit);
  }
  return true;
}

export function MapCameraControls() {
  const viewMode = useMapStore((s) => s.viewMode);
  const gm2dEditorOpen = useMapStore((s) => s.gm2dEditorOpen);
  const firstPerson = useFirstPersonStore((s) => s.enabled);
  const mapFrozen = useMapStore((s) => s.mapFrozen);
  const adjustView3dOrbit = useMapStore((s) => s.adjustView3dOrbit);
  const selectedKey = useItemStore((s) =>
    s.selectedIds.length === 1 ? s.selectedIds[0]! : '',
  );
  const hasSelectedToken = useItemStore((s) => {
    if (s.selectedIds.length !== 1) return false;
    return s.items[s.selectedIds[0]!]?.type === 'token';
  });

  // Orbit zoom/tilt fight FP look; freeze locks the map camera too.
  if (viewMode === '3d' && (firstPerson || mapFrozen)) return null;

  function orbitTokenId(): string | undefined {
    if (viewMode !== '3d' || gm2dEditorOpen) return undefined;
    const item = useItemStore.getState().items[selectedKey];
    return item?.type === 'token' ? selectedKey : undefined;
  }

  function adjustOrbit(deltaAzimuth: number, deltaPolar: number) {
    adjustView3dOrbit(deltaAzimuth, deltaPolar, orbitTokenId());
  }

  // Keep controls over the 3D pane when the GM 2D editor occupies the right side.
  const splitGm2d = viewMode === '3d' && gm2dEditorOpen;

  return (
    <div
      className="absolute top-4 z-40 flex flex-wrap gap-1 max-w-[320px] justify-end"
      style={{
        pointerEvents: 'auto',
        right: splitGm2d ? `calc(${GM_2D_EDITOR_PANE_WIDTH} + 1rem)` : '1rem',
      }}
    >
      <button type="button" className={btn} onClick={() => zoomBy(1.15)}>Zoom In</button>
      <button type="button" className={btn} onClick={() => zoomBy(1 / 1.15)}>Zoom Out</button>
      <button type="button" className={btn} onClick={resetSessionMapView}>Reset View</button>
      {viewMode === '3d' && (
        <>
          <button
            type="button"
            className={hasSelectedToken ? btn : btnDisabled}
            disabled={!hasSelectedToken}
            title={
              hasSelectedToken
                ? 'Center on selected token and look the way it faces'
                : 'Select a token first'
            }
            onClick={() => centerViewOnSelectedToken()}
          >
            Center Facing
          </button>
          <button type="button" className={btn} onClick={() => adjustOrbit(-0.25, 0)}>Rotate Left</button>
          <button type="button" className={btn} onClick={() => adjustOrbit(0.25, 0)}>Rotate Right</button>
          <button type="button" className={btn} onClick={() => adjustOrbit(0, -0.12)}>Tilt Up</button>
          <button type="button" className={btn} onClick={() => adjustOrbit(0, 0.12)}>Tilt Down</button>
        </>
      )}
    </div>
  );
}
