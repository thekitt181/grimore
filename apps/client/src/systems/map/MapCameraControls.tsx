import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { resetSessionMapView } from '@/systems/map/mapFocusSync';
import { clampViewportScale, maxViewportScale } from '@/systems/map/viewportLimits';
import { viewportScaleContext } from '@/systems/map/mapNavigation';
import { isMobileClient } from '@/lib/socket';

const btn = 'btn-ghost text-xs px-2 py-1 rounded border border-[var(--color-border-gold)]';

function zoomBy(factor: number) {
  const world = sceneRefs.world.current;
  const app = sceneRefs.app.current;
  if (!world || !app) return;
  const sw = app.screen.width;
  const sh = app.screen.height;
  const viewMode = useMapStore.getState().viewMode;
  const ctx = viewportScaleContext(app);
  const oldScale = world.scale.x;
  const newScale = clampViewportScale(oldScale * factor, viewMode, maxViewportScale(isMobileClient()), ctx);
  if (Math.abs(newScale - oldScale) < 1e-7) return;
  const ratio = newScale / oldScale;
  world.x = sw / 2 - (sw / 2 - world.x) * ratio;
  world.y = sh / 2 - (sh / 2 - world.y) * ratio;
  world.scale.set(newScale);
  useMapStore.getState().setViewport({ x: world.x, y: world.y, scale: newScale });
}

export function MapCameraControls() {
  const viewMode = useMapStore((s) => s.viewMode);
  const adjustView3dOrbit = useMapStore((s) => s.adjustView3dOrbit);
  const selectedKey = useItemStore((s) =>
    s.selectedIds.length === 1 ? s.selectedIds[0]! : '',
  );

  function orbitTokenId(): string | undefined {
    if (viewMode !== '3d') return undefined;
    const item = useItemStore.getState().items[selectedKey];
    return item?.type === 'token' ? selectedKey : undefined;
  }

  function adjustOrbit(deltaAzimuth: number, deltaPolar: number) {
    adjustView3dOrbit(deltaAzimuth, deltaPolar, orbitTokenId());
  }

  return (
    <div
      className="absolute top-4 right-4 z-40 flex flex-wrap gap-1 max-w-[280px] justify-end"
      style={{ pointerEvents: 'auto' }}
    >
      <button type="button" className={btn} onClick={() => zoomBy(1.15)}>Zoom In</button>
      <button type="button" className={btn} onClick={() => zoomBy(1 / 1.15)}>Zoom Out</button>
      <button type="button" className={btn} onClick={resetSessionMapView}>Reset View</button>
      {viewMode === '3d' && (
        <>
          <button type="button" className={btn} onClick={() => adjustOrbit(-0.25, 0)}>Rotate Left</button>
          <button type="button" className={btn} onClick={() => adjustOrbit(0.25, 0)}>Rotate Right</button>
          <button type="button" className={btn} onClick={() => adjustOrbit(0, -0.12)}>Tilt Up</button>
          <button type="button" className={btn} onClick={() => adjustOrbit(0, 0.12)}>Tilt Down</button>
        </>
      )}
    </div>
  );
}
