import { sceneRefs } from '@/systems/scene/sceneRefs';

/** Canvas-local screen coords (matches Pixi pan/zoom math). */
export function clientToCanvas(clientX: number, clientY: number): { x: number; y: number } | null {
  const app = sceneRefs.app.current;
  if (!app) return null;
  const rect = app.canvas.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
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
