import { getDragLivePosition } from '@/systems/scene/interaction/dragLivePositions';
import type { LiveTransform } from '@/systems/scene/store/liveTransformStore';
import type { Item } from '@/systems/scene/types';

export interface SceneItemBounds {
  x: number;
  y: number;
  cx: number;
  cz: number;
  width: number;
  height: number;
  rotation: number;
}

/** Single source of truth for item bounds in Pixi world-local space (Three X/Z). */
export function resolveItemBounds(item: Item, live?: LiveTransform | null): SceneItemBounds {
  const drag = getDragLivePosition(item.id);
  const x = drag?.x ?? live?.x ?? item.x;
  const y = drag?.y ?? live?.y ?? item.y;
  const width = live?.width ?? item.width;
  const height = live?.height ?? item.height;
  const rotation = live?.rotation ?? item.rotation ?? 0;

  return {
    x,
    y,
    cx: x + width / 2,
    cz: y + height / 2,
    width,
    height,
    rotation,
  };
}
