import type { WebGLRenderer } from 'three';

/** Prevent the browser from permanently dropping the context; caller may remount the canvas. */
export function bindWebGLContextRecovery(
  gl: WebGLRenderer,
  onContextLost: () => void,
): () => void {
  const canvas = gl.domElement;

  const onLost = (event: Event) => {
    event.preventDefault();
    onContextLost();
  };

  canvas.addEventListener('webglcontextlost', onLost, false);
  return () => {
    canvas.removeEventListener('webglcontextlost', onLost);
  };
}
