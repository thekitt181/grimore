import {
  fpVisionCells,
  isTokenVisibleToPlayer,
  losVisibleCellKeys,
} from '@/systems/map/fogLos';
import { visionWalls } from '@/systems/map/props/doorCollision';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import type { Item, TokenItem } from '@/systems/scene/types';
import { firstPersonLook } from './firstPersonLook';
import { firstPersonPose } from './firstPersonPose';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';

type FpLosCache = {
  at: number;
  /** null = do not filter (fog off / not in FP). */
  seen: Set<string> | null;
  viewerId: string | null;
};

const cache: FpLosCache = { at: -1, seen: null, viewerId: null };

/** Rebuild at most every ~50ms while walking; reuse within the same window. */
const LOS_REFRESH_MS = 50;

function viewerTokenForLos(base: TokenItem): TokenItem {
  const cells = fpVisionCells(base);
  let x = base.x;
  let y = base.y;
  let rotation = base.rotation;
  if (firstPersonPose.active && firstPersonPose.tokenId === base.id) {
    x = firstPersonPose.x;
    y = firstPersonPose.y;
    rotation = firstPersonLook.yaw;
  }
  return {
    ...base,
    x,
    y,
    rotation,
    // Torch / darkvision radius; full 360° (look is free in FP).
    visionRadius: cells,
    visionArc: 360,
  };
}

function itemsWithLive(items: Record<string, Item>): Record<string, Item> {
  const live = useLiveTransformStore.getState().byId;
  if (Object.keys(live).length === 0) return items;
  const out: Record<string, Item> = { ...items };
  for (const [id, patch] of Object.entries(live)) {
    const base = out[id];
    if (!base) continue;
    out[id] = { ...base, ...patch } as Item;
  }
  return out;
}

/**
 * Cells the FP viewer can see right now — live LOS within torch/DV range only.
 * Explored 2D fog memory does NOT keep distant tokens visible in FP.
 */
export function getFpFogSeenCells(now = performance.now()): FpLosCache {
  if (now - cache.at < LOS_REFRESH_MS && cache.at >= 0) return cache;
  cache.at = now;

  if (!useFirstPersonStore.getState().enabled || !isFogOverlayVisible()) {
    cache.seen = null;
    cache.viewerId = null;
    return cache;
  }

  const map = getActiveMap();
  const viewerBase = resolveFirstPersonToken();
  if (!map || !viewerBase) {
    cache.seen = new Set();
    cache.viewerId = null;
    return cache;
  }

  const items = itemsWithLive(useItemStore.getState().items);
  const viewer = viewerTokenForLos(
    (items[viewerBase.id] as TokenItem | undefined) ?? viewerBase,
  );
  const walls = visionWalls(map, items);
  cache.seen = losVisibleCellKeys(map, [viewer], map.gridSize, {
    directional: false,
    walls,
  });
  cache.viewerId = viewer.id;
  return cache;
}

/** True when this token should render in FP under table fog (same idea as 2D). */
export function isTokenVisibleInFpFog(token: TokenItem): boolean {
  const { seen, viewerId } = getFpFogSeenCells();
  if (seen == null) return true;
  if (viewerId && token.id === viewerId) return true;
  const map = getActiveMap();
  if (!map) return false;
  const live = useLiveTransformStore.getState().byId[token.id];
  const placed = live ? ({ ...token, ...live } as TokenItem) : token;
  return isTokenVisibleToPlayer(placed, map, seen);
}
