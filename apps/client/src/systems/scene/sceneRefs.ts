import { useMapStore } from '@/systems/map/store/mapStore';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { screenToGroundXZ } from '@/systems/map3d/screenToGround';
import { pixiClientToWorld } from '@/systems/map3d/pixiScreenCoords';
import { pickSceneItemId } from '@/systems/map3d/scenePickRegistry';

/**
 * Module-level references to the live PixiJS application and its layers.
 * Populated by SceneCanvas on init and read by the interaction hooks.
 */
export const sceneRefs = {
  app:        { current: null as import('pixi.js').Application | null },
  world:      { current: null as import('pixi.js').Container | null },
  items:      { current: null as import('pixi.js').Container | null },
  fog:        { current: null as import('pixi.js').Container | null },
  drawPreview:{ current: null as import('pixi.js').Container | null },
  measure:    { current: null as import('pixi.js').Container | null },
  overlay:    { current: null as import('pixi.js').Container | null },
};

/** Raycast Three.js pick volumes (tokens/maps) — works in 2D and 3D view. */
export function pickSceneItem(clientX: number, clientY: number): string | null {
  const app = sceneRefs.app.current;
  const cam = sceneCameraRef.current;
  if (!app || !cam) return null;
  const rect = app.canvas.getBoundingClientRect();
  return pickSceneItemId(clientX, clientY, rect, cam);
}

/** Convert a DOM client point to world-space coordinates. */
export function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const viewMode = useMapStore.getState().viewMode;
  if (viewMode === '3d') {
    return pixiClientToWorld(clientX, clientY);
  }

  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  if (!app || !world) return { x: 0, y: 0 };
  const rect = app.canvas.getBoundingClientRect();
  const cam = sceneCameraRef.current;

  if (cam?.type === 'perspective') {
    const ground = screenToGroundXZ(clientX, clientY, rect, cam);
    if (ground) return ground;
  }

  return pixiClientToWorld(clientX, clientY);
}
