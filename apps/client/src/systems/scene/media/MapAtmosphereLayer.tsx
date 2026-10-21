import { LightingTintOverlay, WeatherOverlay } from './SceneAtmosphere';
import { TimeOfDayOverlay } from './TimeOfDayOverlay';
import { useMapScreenBounds } from './useMapScreenBounds';
import { useMapStore } from '@/systems/map/store/mapStore';

/** Weather, time-of-day, and lighting — clipped to the map image only. */
export function MapAtmosphereLayer() {
  const bounds = useMapScreenBounds();
  const view3d = useMapStore((s) => s.viewMode === '3d');

  if (!bounds.visible || bounds.width < 4 || bounds.height < 4) return null;

  return (
    <div
      className="pointer-events-none absolute z-[3] overflow-hidden"
      style={{
        left: bounds.left,
        top: bounds.top,
        width: bounds.width,
        height: bounds.height,
      }}
    >
      {/* 3D / FP uses FpTimeOfDay3D + FpWeather3D (map-wide). */}
      {!view3d && (
        <>
          <TimeOfDayOverlay />
          <LightingTintOverlay />
          <WeatherOverlay />
        </>
      )}
    </div>
  );
}
