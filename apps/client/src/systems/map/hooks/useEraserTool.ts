import { useEffect } from 'react';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemRemove, emitItemUpdate } from '@/systems/scene/sceneSync';
import { hitTest } from '@/systems/scene/hitTest';
import type { MapItem, WallSegment } from '@/systems/scene/types';

const WALL_ERASE_RADIUS = 14;

function distToSegment(px: number, py: number, seg: WallSegment): number {
  const { a, b } = seg;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - a.x, py - a.y);
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq));
  return Math.hypot(px - a.x - t * dx, py - a.y - t * dy);
}

function eraseNearestWall(map: MapItem, localX: number, localY: number): boolean {
  const walls = map.walls ?? [];
  let bestIdx = -1;
  let bestD = WALL_ERASE_RADIUS;
  walls.forEach((seg, i) => {
    const d = distToSegment(localX, localY, seg);
    if (d < bestD) { bestD = d; bestIdx = i; }
  });
  if (bestIdx < 0) return false;
  const next = walls.filter((_, i) => i !== bestIdx);
  const patch: Partial<MapItem> = { walls: next };
  useItemStore.getState().updateItem(map.id, patch);
  emitItemUpdate([{ id: map.id, patch }]);
  return true;
}

function canEraseItem(
  item: { type: string; ownerId?: string },
  isGM: boolean,
  myUserId: string | null,
): boolean {
  if (item.type !== 'drawing' && item.type !== 'text') return false;
  if (isGM) return true;
  return Boolean(myUserId && item.ownerId === myUserId);
}

/**
 * Eraser — removes drawings/text under cursor; GM can also erase wall segments.
 */
export function useEraserTool(appReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const myRole = useSessionStore((s) => s.myRole);
  const myUserId = useSessionStore((s) => s.myUserId);
  const isGM = myRole === 'GM';

  useEffect(() => {
    if (!appReady || activeTool !== 'eraser') return;

    const app = mapLayerRefs.app.current;
    const world = mapLayerRefs.world.current;
    if (!app || !world) return;

    const canvas = app.canvas;
    canvas.style.cursor = 'cell';

    function toWorld(clientX: number, clientY: number) {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left - world!.x) / world!.scale.x,
        y: (clientY - rect.top - world!.y) / world!.scale.y,
      };
    }

    function eraseAt(clientX: number, clientY: number) {
      const wp = toWorld(clientX, clientY);
      const items = Object.values(useItemStore.getState().items);

      const drawable = items.filter(
        (i) => (i.type === 'drawing' || i.type === 'text') && canEraseItem(i, isGM, myUserId),
      );
      const hit = hitTest(drawable, wp.x, wp.y, { includeLocked: true });
      if (hit && (hit.type === 'drawing' || hit.type === 'text')) {
        useItemStore.getState().removeItems([hit.id]);
        emitItemRemove([hit.id]);
        return;
      }

      if (isGM) {
        const map = getActiveMap();
        if (map) {
          eraseNearestWall(map, wp.x - map.x, wp.y - map.y);
        }
      }
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      eraseAt(e.clientX, e.clientY);
      canvas.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (e.buttons !== 1) return;
      eraseAt(e.clientX, e.clientY);
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);

    return () => {
      canvas.style.cursor = 'default';
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
    };
  }, [appReady, activeTool, isGM, myUserId]);
}
