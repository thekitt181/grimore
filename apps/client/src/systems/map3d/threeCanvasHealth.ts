import type { WebGLRenderer } from 'three';
import { sceneRefs } from '@/systems/scene/sceneRefs';

let glRef: WebGLRenderer | null = null;
let hasRenderedFrame = false;
let readyDispatched = false;

export function registerThreeRenderer(gl: WebGLRenderer): void {
  glRef = gl;
  hasRenderedFrame = false;
  readyDispatched = false;
}

export function resetThreeCanvasHealth(): void {
  glRef = null;
  hasRenderedFrame = false;
  readyDispatched = false;
}

function contextLost(): boolean {
  const ctx = glRef?.getContext();
  return Boolean(ctx && typeof ctx.isContextLost === 'function' && ctx.isContextLost());
}

/** Canvas mounted with usable dimensions and a live WebGL context. */
export function isThreeCanvasHealthy(): boolean {
  const canvas = sceneRefs.threeCanvas.current;
  if (!canvas || contextLost()) return false;
  const rect = canvas.getBoundingClientRect?.();
  const w = canvas.clientWidth || rect?.width || canvas.width || 0;
  const h = canvas.clientHeight || rect?.height || canvas.height || 0;
  if (w > 16 && h > 16) return true;
  const gl = glRef?.domElement === canvas ? glRef.getContext() : null;
  return Boolean(gl && gl.drawingBufferWidth > 16 && gl.drawingBufferHeight > 16);
}

/** Healthy and at least one frame has been drawn — safe to hide Pixi fallbacks on mobile. */
export function isThreeReadyForDisplay(): boolean {
  return isThreeCanvasHealthy() && hasRenderedFrame;
}

export const THREE_READY_EVENT = 'grimoire:three-ready';
export const THREE_UNHEALTHY_EVENT = 'grimoire:three-unhealthy';

export function markThreeFrameRendered(): void {
  if (!isThreeCanvasHealthy()) return;
  hasRenderedFrame = true;
  notifyThreeCanvasReady();
}

export function notifyThreeCanvasReady(): void {
  if (!isThreeReadyForDisplay() || readyDispatched) return;
  readyDispatched = true;
  window.dispatchEvent(new CustomEvent(THREE_READY_EVENT));
}

export function notifyThreeCanvasUnhealthy(): void {
  hasRenderedFrame = false;
  readyDispatched = false;
  window.dispatchEvent(new CustomEvent(THREE_UNHEALTHY_EVENT));
}
