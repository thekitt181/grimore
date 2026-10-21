import { getDragLivePosition } from '@/systems/scene/interaction/dragLivePositions';
import type { LiveTransform } from '@/systems/scene/store/liveTransformStore';
import { getWalkPose, WALK_POSE_FRESH_MS } from '@/systems/scene/token/walkPoseBus';
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

/**
 * Bounds in Pixi world space (Three X/Z).
 * Local drag wins over walk (otherwise post-FP drag snaps back for ~2s).
 * Fresh walk still beats live/item for remote FP viewers.
 */
export function resolveItemBounds(item: Item, live?: LiveTransform | null): SceneItemBounds {
  const drag = getDragLivePosition(item.id);
  const walk = item.type === 'token' ? getWalkPose(item.id) : undefined;
  const walkFresh = Boolean(
    !drag && walk && performance.now() - walk.at < WALK_POSE_FRESH_MS,
  );

  const x = drag?.x ?? (walkFresh ? walk!.x : (live?.x ?? item.x));
  const y = drag?.y ?? (walkFresh ? walk!.y : (live?.y ?? item.y));
  const width = live?.width ?? item.width;
  const height = live?.height ?? item.height;
  const rotation = walkFresh
    ? (walk!.rotation ?? live?.rotation ?? item.rotation ?? 0)
    : (live?.rotation ?? item.rotation ?? 0);

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
