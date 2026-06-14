import { useEffect } from 'react';
import { useMapStore } from '../store/mapStore';
import { mapLayerRefs } from '../MapCanvas';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { emitItemRemove, emitItemUpdate } from '@/systems/scene/sceneSync';
import { hitTest } from '@/systems/scene/hitTest';
import { eraseWallsAtPoint, toMapLocal, wallsChanged, WALL_ERASE_RADIUS } from '../wallUtils';
import { clientToWorld, getMapToolElement } from '../mapToolPointer';

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
export function useEraserTool(appReady = false, interactionReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const myRole = useSessionStore((s) => s.myRole);
  const myUserId = useSessionStore((s) => s.myUserId);
  const isGM = myRole === 'GM';

  useEffect(() => {
    if (!appReady || !interactionReady || activeTool !== 'eraser') return;

    const world = mapLayerRefs.world.current;
    const el = getMapToolElement();
    if (!world || !el) return;
    const toolEl = el;

    toolEl.style.cursor = 'cell';

    function toWorld(clientX: number, clientY: number) {
      return clientToWorld(clientX, clientY);
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
        if (!map) return;
        const local = toMapLocal(wp.x, wp.y, map);
        const walls = map.walls ?? [];
        const next = eraseWallsAtPoint(walls, local.x, local.y, WALL_ERASE_RADIUS);
        if (!wallsChanged(walls, next)) return;
        useItemStore.getState().clearWallSelection();
        const patch = { walls: next };
        useItemStore.getState().updateItem(map.id, patch);
        emitItemUpdate([{ id: map.id, patch }]);
      }
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      eraseAt(e.clientX, e.clientY);
      toolEl.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (e.buttons !== 1) return;
      eraseAt(e.clientX, e.clientY);
    }

    toolEl.addEventListener('pointerdown', onDown, true);
    toolEl.addEventListener('pointermove', onMove, true);

    return () => {
      toolEl.style.cursor = '';
      toolEl.removeEventListener('pointerdown', onDown, true);
      toolEl.removeEventListener('pointermove', onMove, true);
    };
  }, [appReady, interactionReady, activeTool, isGM, myUserId]);
}
