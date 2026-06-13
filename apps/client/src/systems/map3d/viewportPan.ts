import type { Application, Container } from 'pixi.js';
import type { MapViewport } from '@/systems/map/store/mapStore';
import { screenPanToGroundDelta } from './coords';

/** Screen drag → viewport offset (Pixi world container x/y). */
export function applyScreenPan(
  startVpX: number,
  startVpY: number,
  screenDx: number,
  screenDy: number,
  azimuth: number,
  scale: number,
  app: Application | null,
): MapViewport {
  // Default: 1:1 screen drag (matches standard map pan in 2D).
  if (Math.abs(azimuth) < 1e-5 || !app) {
    return { x: startVpX + screenDx, y: startVpY + screenDy, scale };
  }

  const screenW = app.screen.width;
  const screenH = app.screen.height;
  const { dcx, dcz } = screenPanToGroundDelta(screenDx, screenDy, azimuth, scale);
  const cx0 = (screenW / 2 - startVpX) / scale;
  const cz0 = (screenH / 2 - startVpY) / scale;
  return {
    x: screenW / 2 - (cx0 + dcx) * scale,
    y: screenH / 2 - (cz0 + dcz) * scale,
    scale,
  };
}

/** Pan the Pixi world in 3D view — screen drag follows the orbited camera heading. */
export function apply3dScreenPan(
  world: Container,
  app: Application,
  screenDx: number,
  screenDy: number,
  startVpX: number,
  startVpY: number,
  azimuth: number,
): MapViewport {
  const vp = applyScreenPan(
    startVpX,
    startVpY,
    screenDx,
    screenDy,
    azimuth,
    world.scale.x,
    app,
  );
  world.x = vp.x;
  world.y = vp.y;
  return vp;
}
