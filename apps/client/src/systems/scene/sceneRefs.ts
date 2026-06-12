import type { Application, Container } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { view3dCameraRef } from '@/systems/map3d/view3dCameraRef';
import { screenToGroundXZ } from '@/systems/map3d/screenToGround';

/**
 * Module-level references to the live PixiJS application and its layers.
 * Populated by SceneCanvas on init and read by the interaction hooks.
 */
export const sceneRefs = {
  app:        { current: null as Application | null },
  world:      { current: null as Container | null }, // pan/zoom root
  items:      { current: null as Container | null }, // sortable item containers
  fog:        { current: null as Container | null },
  drawPreview:{ current: null as Container | null }, // live drawing/calibrate preview
  measure:    { current: null as Container | null },
  overlay:    { current: null as Container | null }, // selection box, handles, marquee
};

/** Convert a DOM client point to world-space coordinates (2D top-down or 3D ground raycast). */
export function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  if (!app || !world) return { x: 0, y: 0 };
  const rect = app.canvas.getBoundingClientRect();

  if (useMapStore.getState().viewMode === '3d' && view3dCameraRef.current) {
    const ground = screenToGroundXZ(clientX, clientY, rect, view3dCameraRef.current);
    if (ground) return ground;
  }

  return {
    x: (clientX - rect.left - world.x) / world.scale.x,
    y: (clientY - rect.top - world.y) / world.scale.y,
  };
}
