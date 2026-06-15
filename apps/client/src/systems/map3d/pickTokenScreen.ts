import { clientToWorld } from '@/systems/scene/sceneRefs';
import { getPickCanvasRect } from './pickCamera';
import { sceneCameraRef } from './sceneCameraRef';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { worldXZToClientScreen } from './perspectiveCameraSync';
import type { TokenItem } from '@/systems/scene/types';

function pickTokenAtScreen2d(clientX: number, clientY: number, tokens: TokenItem[]): string | null {
  const { x: clickWx, y: clickWy } = clientToWorld(clientX, clientY);
  const scale = Math.max(useMapStore.getState().viewport.scale, 0.08);
  const pad = 8 / scale;
  const liveById = useLiveTransformStore.getState().byId;

  for (const token of tokens) {
    const b = resolveItemBounds(token, liveById[token.id]);
    if (
      clickWx >= b.x - pad && clickWx <= b.x + b.width + pad
      && clickWy >= b.y - pad && clickWy <= b.y + b.height + pad
    ) {
      return token.id;
    }
  }

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const b = resolveItemBounds(token, liveById[token.id]);
    const dist = Math.hypot(clickWx - b.cx, clickWy - b.cz);
    const hitWorld = Math.max(b.width, b.height) * 0.55 + pad;
    if (dist <= hitWorld && dist < bestDist) {
      bestDist = dist;
      bestId = token.id;
    }
  }

  return bestId;
}

/** Screen pick using projected token bounds — works for 3D orthographic + perspective cameras. */
function pickTokenAtScreen3d(clientX: number, clientY: number, tokens: TokenItem[]): string | null {
  const rect = getPickCanvasRect();
  if (!rect || !sceneCameraRef.liveCamera) {
    return pickTokenAtScreen2d(clientX, clientY, tokens);
  }

  const liveById = useLiveTransformStore.getState().byId;
  const pad = 10;
  let bestId: string | null = null;
  let bestDist = Infinity;

  for (const token of tokens) {
    const b = resolveItemBounds(token, liveById[token.id]);
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
      bestId = token.id;
    }
  }

  return bestId;
}

/** Screen pick fallback for tokens when Three.js raycast misses. */
export function pickTokenAtScreen(clientX: number, clientY: number, tokens: TokenItem[]): string | null {
  if (tokens.length === 0) return null;

  const viewMode = useMapStore.getState().viewMode;
  if (viewMode === '3d') {
    return pickTokenAtScreen3d(clientX, clientY, tokens);
  }
  return pickTokenAtScreen2d(clientX, clientY, tokens);
}
