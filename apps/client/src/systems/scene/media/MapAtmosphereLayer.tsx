import { LightingTintOverlay, WeatherOverlay } from './SceneAtmosphere';
import { TimeOfDayOverlay } from './TimeOfDayOverlay';
import { useMapScreenBounds } from './useMapScreenBounds';

/** Weather, time-of-day, and lighting — clipped to the map image only. */
export function MapAtmosphereLayer() {
  const bounds = useMapScreenBounds();

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
      <TimeOfDayOverlay />
      <LightingTintOverlay />
      <WeatherOverlay />
    </div>
  );
}
