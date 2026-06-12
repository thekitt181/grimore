import type { Application, Container } from 'pixi.js';
import type { MapViewport } from '@/systems/map/store/mapStore';
import { screenPanToGroundDelta } from './coords';

/** Pan the Pixi world in 3D orbit view (screen-aligned drag). */
export function apply3dScreenPan(
  world: Container,
  app: Application,
  screenDx: number,
  screenDy: number,
  startVpX: number,
  startVpY: number,
  azimuth: number,
): MapViewport {
  const s = world.scale.x;
  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const { dcx, dcz } = screenPanToGroundDelta(screenDx, screenDy, azimuth, s);
  const cx0 = (screenW / 2 - startVpX) / s;
  const cz0 = (screenH / 2 - startVpY) / s;
  world.x = screenW / 2 - (cx0 + dcx) * s;
  world.y = screenH / 2 - (cz0 + dcz) * s;
  return { x: world.x, y: world.y, scale: s };
}
