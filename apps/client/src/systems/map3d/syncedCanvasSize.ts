import { pixiScreenSize } from './pixiCanvasMetrics';

/** Screen size shared by Pixi + Three (resolution pixels — must match pan/zoom math). */
export function syncedCanvasSize(fallbackW: number, fallbackH: number): { w: number; h: number } {
  const pixi = pixiScreenSize();
  if (pixi) return pixi;
  return { w: fallbackW, h: fallbackH };
}
