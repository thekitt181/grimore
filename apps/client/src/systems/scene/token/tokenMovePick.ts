import { useMapStore } from '@/systems/map/store/mapStore';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { worldXZToClientScreen } from '@/systems/map3d/perspectiveCameraSync';
import { clientToWorld } from '@/systems/scene/sceneRefs';
import { isInteriorClickBounds } from '@/systems/scene/hitTest';
import type { SceneItemBounds } from '@/systems/map3d/sceneItemBounds';

function isInsideScreenRect(
  clientX: number,
  clientY: number,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  inset: number,
): boolean {
  if (maxX - minX <= inset * 2 || maxY - minY <= inset * 2) {
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const pad = Math.max(8, Math.min(maxX - minX, maxY - minY) * 0.35);
    return Math.abs(clientX - cx) <= pad && Math.abs(clientY - cy) <= pad;
  }
  return (
    clientX > minX + inset
    && clientX < maxX - inset
    && clientY > minY + inset
    && clientY < maxY - inset
  );
}

/** True when the pointer is on the token body — drag should move, not resize. */
export function isTokenMoveClick(
  clientX: number,
  clientY: number,
  bounds: SceneItemBounds,
): boolean {
  const viewMode = useMapStore.getState().viewMode;
  const { x: wx, y: wy } = clientToWorld(clientX, clientY);

  if (viewMode === '3d') {
    const rect = getPickCanvasRect();
    if (!rect || !sceneCameraRef.liveCamera) {
      return isInteriorClickBounds(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.rotation,
        wx,
        wy,
        0.48,
      );
    }

    const corners = [
      worldXZToClientScreen(bounds.x, bounds.y, rect),
      worldXZToClientScreen(bounds.x + bounds.width, bounds.y, rect),
      worldXZToClientScreen(bounds.x + bounds.width, bounds.y + bounds.height, rect),
      worldXZToClientScreen(bounds.x, bounds.y + bounds.height, rect),
    ];
    if (corners.some((c) => c == null)) {
      return isInteriorClickBounds(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        bounds.rotation,
        wx,
        wy,
        0.48,
      );
    }

    const xs = corners.map((c) => c!.x);
    const ys = corners.map((c) => c!.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const screenMin = Math.min(maxX - minX, maxY - minY);
    const inset = Math.max(14, screenMin * 0.24);
    return isInsideScreenRect(clientX, clientY, minX, minY, maxX, maxY, inset);
  }

  return isInteriorClickBounds(
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    bounds.rotation,
    wx,
    wy,
    0.48,
  );
}
