import { pickSceneItem } from '@/systems/scene/sceneRefs';
import { pointInItem } from '@/systems/scene/hitTest';
import { itemDisplayZIndex } from '@/systems/scene/zOrder';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { clientToWorld } from '@/systems/scene/sceneRefs';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { worldXZToClientScreen } from '@/systems/map3d/perspectiveCameraSync';
import { playerInteractableTokens } from './clientTokenVisibility';
import type { TokenItem } from '../types';

/** Unlocked visible tokens the current client may drag (GM: all; players: same rules). */
export function allInteractableTokens(): TokenItem[] {
  const items = useItemStore.getState().items;
  if (useSessionStore.getState().myRole === 'GM') {
    return Object.values(items).filter(
      (i): i is TokenItem => i.type === 'token' && i.visible !== false && !i.locked,
    );
  }
  return playerInteractableTokens(items);
}

function sortTopmost(tokens: TokenItem[]): TokenItem[] {
  return [...tokens].sort((a, b) => itemDisplayZIndex(b) - itemDisplayZIndex(a));
}

function pickByWorldPoint(wx: number, wy: number, tokens: TokenItem[]): TokenItem | null {
  const liveById = useLiveTransformStore.getState().byId;
  const scale = Math.max(useMapStore.getState().viewport.scale, 0.08);
  const pad = Math.max(18, 24 / scale);

  for (const token of sortTopmost(tokens)) {
    const b = resolveItemBounds(token, liveById[token.id]);
    const probe = { ...token, x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation };
    if (pointInItem(probe, wx, wy)) return token;
  }

  let best: TokenItem | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const b = resolveItemBounds(token, liveById[token.id]);
    const dist = Math.hypot(wx - b.cx, wy - b.cz);
    const hitR = Math.max(b.width, b.height) * 0.62 + pad;
    if (dist <= hitR && dist < bestDist) {
      bestDist = dist;
      best = token;
    }
  }
  return best;
}

function pickByScreenBox(clientX: number, clientY: number, tokens: TokenItem[]): TokenItem | null {
  const rect = getPickCanvasRect();
  const liveById = useLiveTransformStore.getState().byId;
  const viewMode = useMapStore.getState().viewMode;
  const pad = viewMode === '3d' ? 40 : 20;

  let best: TokenItem | null = null;
  let bestDist = Infinity;
  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  const scale = scaleFromViewport();

  for (const token of sortTopmost(tokens)) {
    const b = resolveItemBounds(token, liveById[token.id]);

    if (viewMode === '3d' && rect && sceneCameraRef.liveCamera) {
      const corners = [
        worldXZToClientScreen(b.x, b.y, rect),
        worldXZToClientScreen(b.x + b.width, b.y, rect),
        worldXZToClientScreen(b.x + b.width, b.y + b.height, rect),
        worldXZToClientScreen(b.x, b.y + b.height, rect),
      ];
      if (corners.some((c) => c == null)) continue;
      const xs = corners.map((c) => c!.x);
      const ys = corners.map((c) => c!.y);
      const minX = Math.min(...xs) - pad;
      const maxX = Math.max(...xs) + pad;
      const minY = Math.min(...ys) - pad;
      const maxY = Math.max(...ys) + pad;
      if (clientX < minX || clientX > maxX || clientY < minY || clientY > maxY) continue;
      const center = worldXZToClientScreen(b.cx, b.cz, rect);
      if (!center) continue;
      const dist = Math.hypot(clientX - center.x, clientY - center.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = token;
      }
      continue;
    }

    const probe = { ...token, x: b.x, y: b.y, width: b.width, height: b.height, rotation: b.rotation };
    if (pointInItem(probe, wx, wy)) return token;
    const dist = Math.hypot(wx - b.cx, wy - b.cz);
    const hitR = Math.max(b.width, b.height) * 0.62 + pad / Math.max(scale, 0.08);
    if (dist <= hitR && dist < bestDist) {
      bestDist = dist;
      best = token;
    }
  }

  return best;
}

function scaleFromViewport(): number {
  return useMapStore.getState().viewport.scale;
}

/** Best-effort token under the pointer — raycast, screen bounds, then world fallback. */
export function pickInteractableTokenAt(clientX: number, clientY: number): TokenItem | null {
  const tokens = allInteractableTokens();
  if (tokens.length === 0) return null;

  const pickId = pickSceneItem(clientX, clientY);
  if (pickId) {
    const ray = useItemStore.getState().items[pickId];
    if (ray?.type === 'token' && ray.visible !== false && !ray.locked) {
      return ray as TokenItem;
    }
  }

  const screenHit = pickByScreenBox(clientX, clientY, tokens);
  if (screenHit) return screenHit;

  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  return pickByWorldPoint(wx, wy, tokens);
}
