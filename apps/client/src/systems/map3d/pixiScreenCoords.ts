import { sceneRefs } from '@/systems/scene/sceneRefs';

/** Same DOM rect as map pointer input (interaction overlay → Pixi canvas). */
function getMapClientRect(): DOMRect | null {
  const interaction = sceneRefs.interactionRoot.current;
  if (interaction) return interaction.getBoundingClientRect();
  const app = sceneRefs.app.current;
  if (app) return app.canvas.getBoundingClientRect();
  return null;
}

/** Scale a CSS pixel delta to Pixi screen/resolution space. */
export function clientDeltaToScreen(clientDx: number, clientDy: number): { x: number; y: number } {
  const app = sceneRefs.app.current;
  if (!app) return { x: clientDx, y: clientDy };
  const rect = getMapClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return { x: clientDx, y: clientDy };
  return {
    x: clientDx * (app.screen.width / rect.width),
    y: clientDy * (app.screen.height / rect.height),
  };
}

/** Canvas-local coords in Pixi screen space (resolution pixels). */
export function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } | null {
  const app = sceneRefs.app.current;
  if (!app) return null;
  const rect = getMapClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * app.screen.width,
    y: ((clientY - rect.top) / rect.height) * app.screen.height,
  };
}

/** Pixi world x/y from a DOM click — same in 2D and 3D (authoritative for pan/zoom). */
export function pixiClientToWorld(clientX: number, clientY: number): { x: number; y: number } {
  const app = sceneRefs.app.current;
  const world = sceneRefs.world.current;
  const canvas = clientToCanvas(clientX, clientY);
  if (!app || !world || !canvas) return { x: 0, y: 0 };
  const scale = world.scale.x;
  return {
    x: (canvas.x - world.x) / scale,
    y: (canvas.y - world.y) / scale,
  };
}
