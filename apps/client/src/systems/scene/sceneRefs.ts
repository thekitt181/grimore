import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { pixiClientToWorld } from '@/systems/map3d/pixiScreenCoords';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
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
  threeCanvas:{ current: null as HTMLCanvasElement | null },
  /** Transparent layer above Three.js — receives pan/select/zoom in 3D view. */
  interactionRoot: { current: null as HTMLDivElement | null },
};

/** DOM target for map pointer/wheel handlers (falls back to Pixi canvas). */
export function getMapInteractionEl(): HTMLElement | null {
  return sceneRefs.interactionRoot.current ?? sceneRefs.app.current?.canvas ?? null;
}

export function getSceneCanvasRect(): DOMRect | null {
  const interaction = sceneRefs.interactionRoot.current;
  if (interaction) return interaction.getBoundingClientRect();
  const app = sceneRefs.app.current;
  if (app) return app.canvas.getBoundingClientRect();
  const three = sceneRefs.threeCanvas.current;
  if (three) return three.getBoundingClientRect();
  return null;
}

/** Raycast Three.js pick volumes (tokens/maps) — works in 2D and 3D view. */
export function pickSceneItem(clientX: number, clientY: number): string | null {
  const cam = sceneCameraRef.current;
  if (!cam) return null;
  return pickSceneItemId(clientX, clientY, getPickCanvasRect(), cam);
}

/**
 * Convert a DOM client point to map x/y in Pixi world space.
 * Same coordinate system in 2D and 3D — matches pan/zoom and stored item positions.
 */
export function clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  return pixiClientToWorld(clientX, clientY);
}
