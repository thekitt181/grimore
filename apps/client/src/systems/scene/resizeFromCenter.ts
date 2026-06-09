import { snapSize } from './snap';
import type { Item } from './types';

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

export interface CenterResizeResult {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Compute a new size + top-left position that keeps the item's center fixed
 * at (centerX, centerY) while dragging a transform handle toward (wx, wy).
 */
export function resizeFromCenter(
  item: Item,
  centerX: number,
  centerY: number,
  wx: number,
  wy: number,
  handleSx: number,
  handleSy: number,
  opts: { minSize?: number; snap?: boolean; aspectLock?: boolean } = {},
): CenterResizeResult {
  const MIN = opts.minSize ?? 16;
  const rel = rot(wx - centerX, wy - centerY, -item.rotation);

  let halfW = item.width / 2;
  let halfH = item.height / 2;

  if (handleSx !== 0) halfW = Math.max(MIN / 2, Math.abs(rel.x));
  if (handleSy !== 0) halfH = Math.max(MIN / 2, Math.abs(rel.y));

  let newW = halfW * 2;
  let newH = halfH * 2;

  if (opts.aspectLock) {
    const ratio = item.width / item.height;
    if (handleSx !== 0 && handleSy !== 0) {
      const sca = Math.max(newW / item.width, newH / item.height);
      newW = item.width * sca;
      newH = item.height * sca;
    } else if (handleSx !== 0) {
      newH = newW / ratio;
    } else if (handleSy !== 0) {
      newW = newH * ratio;
    }
  }

  if (opts.snap) {
    if (handleSx !== 0) newW = snapSize(newW);
    if (handleSy !== 0) newH = snapSize(newH);
    if (opts.aspectLock) {
      const ratio = item.width / item.height;
      if (handleSx !== 0 && handleSy !== 0) {
        const sca = Math.max(newW / item.width, newH / item.height);
        newW = snapSize(item.width * sca);
        newH = newW / ratio;
      } else if (handleSx !== 0) {
        newH = newW / ratio;
      } else if (handleSy !== 0) {
        newW = newH * ratio;
      }
    }
  }

  return {
    width: newW,
    height: newH,
    x: centerX - newW / 2,
    y: centerY - newH / 2,
  };
}

/** Apply a width/height change while keeping the current center fixed. */
export function patchSizeFromCenter(
  item: Item,
  patch: { width?: number; height?: number },
): { width: number; height: number; x: number; y: number } {
  const cx = item.x + item.width / 2;
  const cy = item.y + item.height / 2;
  const width = patch.width ?? item.width;
  const height = patch.height ?? item.height;
  return { width, height, x: cx - width / 2, y: cy - height / 2 };
}
