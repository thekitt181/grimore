import type { MapViewport } from '@/systems/map/store/mapStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { pixiScreenSize } from './pixiCanvasMetrics';

/** World X/Z (Pixi x/y) at the center of the screen — reads live Pixi world transform. */
export function viewportGroundCenter(
  viewport: MapViewport,
  screenW: number,
  screenH: number,
): { cx: number; cz: number; scale: number } {
  const world = sceneRefs.world.current;
  const screen = pixiScreenSize();
  const w = screen?.w ?? screenW;
  const h = screen?.h ?? screenH;

  if (world) {
    const scale = world.scale.x;
    return {
      cx: (w / 2 - world.x) / scale,
      cz: (h / 2 - world.y) / scale,
      scale,
    };
  }
  const scale = viewport.scale;
  return {
    cx: (w / 2 - viewport.x) / scale,
    cz: (h / 2 - viewport.y) / scale,
    scale,
  };
}
