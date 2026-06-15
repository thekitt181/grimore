import { sceneRefs } from '@/systems/scene/sceneRefs';

/** True when the Three.js canvas is mounted and has usable dimensions. */
export function isThreeCanvasHealthy(): boolean {
  const canvas = sceneRefs.threeCanvas.current;
  if (!canvas) return false;
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  return w > 16 && h > 16;
}

export const THREE_READY_EVENT = 'grimoire:three-ready';

export function notifyThreeCanvasReady(): void {
  if (!isThreeCanvasHealthy()) return;
  window.dispatchEvent(new CustomEvent(THREE_READY_EVENT));
}
