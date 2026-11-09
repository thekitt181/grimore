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
  const scale = world?.scale.x ?? viewport.scale;
  const panX = world?.x ?? viewport.x;
  const panY = world?.y ?? viewport.y;
  const s = Math.abs(scale) > 1e-8 ? scale : 1;
  return {
    cx: (w / 2 - panX) / s,
    cz: (h / 2 - panY) / s,
    scale: s,
  };
}
