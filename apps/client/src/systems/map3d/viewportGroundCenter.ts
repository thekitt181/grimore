import type { MapViewport } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';

/** World X/Z (Pixi x/y) at the center of the screen — reads live Pixi world transform. */
export function viewportGroundCenter(
  viewport: MapViewport,
  screenW: number,
  screenH: number,
): { cx: number; cz: number; scale: number } {
  const world = sceneRefs.world.current;
  if (world) {
    const scale = world.scale.x;
    return {
      cx: (screenW / 2 - world.x) / scale,
      cz: (screenH / 2 - world.y) / scale,
      scale,
    };
  }
  const scale = viewport.scale;
  return {
    cx: (screenW / 2 - viewport.x) / scale,
    cz: (screenH / 2 - viewport.y) / scale,
    scale,
  };
}
