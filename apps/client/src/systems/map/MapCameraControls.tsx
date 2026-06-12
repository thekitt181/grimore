import { sceneRefs } from '@/systems/scene/sceneRefs';
import { useMapStore } from '@/systems/map/store/mapStore';
import { fitMapToScreen } from '@/systems/map/hooks/useMapViewport';
import { clampViewportScale } from '@/systems/map/viewportLimits';
import { isMobileClient } from '@/lib/socket';

function maxScale(): number {
  return isMobileClient() ? 24 : 8;
}

function zoomBy(factor: number) {
  const world = sceneRefs.world.current;
  const app = sceneRefs.app.current;
  if (!world || !app) return;
  const sw = app.screen.width;
  const sh = app.screen.height;
  const viewMode = useMapStore.getState().viewMode;
  const oldScale = world.scale.x;
  const newScale = clampViewportScale(oldScale * factor, viewMode, maxScale());
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
  const resetView3dOrbit = useMapStore((s) => s.resetView3dOrbit);

  function resetView() {
    const app = sceneRefs.app.current;
    const world = sceneRefs.world.current;
    if (app && world) fitMapToScreen(app, world);
    if (viewMode === '3d') resetView3dOrbit();
  }

  const btn = 'btn-ghost text-xs px-2 py-1 rounded border border-[var(--color-border-gold)]';

  return (
    <div
      className="absolute top-4 right-4 z-40 flex flex-wrap gap-1 max-w-[280px] justify-end"
      style={{ pointerEvents: 'auto' }}
    >
      <button type="button" className={btn} onClick={() => zoomBy(1.15)}>Zoom In</button>
      <button type="button" className={btn} onClick={() => zoomBy(1 / 1.15)}>Zoom Out</button>
      <button type="button" className={btn} onClick={resetView}>Reset View</button>
      {viewMode === '3d' && (
        <>
          <button type="button" className={btn} onClick={() => adjustView3dOrbit(-0.25, 0)}>Rotate Left</button>
          <button type="button" className={btn} onClick={() => adjustView3dOrbit(0.25, 0)}>Rotate Right</button>
          <button type="button" className={btn} onClick={() => adjustView3dOrbit(0, -0.12)}>Tilt Up</button>
          <button type="button" className={btn} onClick={() => adjustView3dOrbit(0, 0.12)}>Tilt Down</button>
        </>
      )}
    </div>
  );
}
