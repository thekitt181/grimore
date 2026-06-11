import { useEffect } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import {
  isTokenVisibleToPlayer,
  playerHasVisionSource,
  playerSeenCellKeys,
} from '@/systems/map/fogLos';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { itemsWithLiveTransforms } from '../store/liveTransformStore';
import { sceneRefs, clientToWorld } from '../sceneRefs';
import { hitTest, hitTestMap, itemIntersectsRect, isInteriorClick } from '../hitTest';
import { snapPoint } from '../snap';
import { emitItemUpdate } from '../sceneSync';
import { getItemContainer } from '../render/useItemRenderer';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { pickHandle } from './useTransformControls';
import type { Item, HandoutItem, MapItem } from '../types';
import { useHandoutViewerStore } from '@/systems/compendium/handoutViewerStore';
import { isMobileClient } from '@/lib/socket';
import { isDdbPcToken } from '@/systems/ddb/ddbTokenUtils';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import { nearestWallIndex, wallIndicesInWorldRect, wallHandleWorldPoints, pickWallHandle, translateWallIndices, moveWallEndpoint, wallsChanged, worldToMapLocal, mapLocalToWorld, WALL_PICK_RADIUS } from '@/systems/map/wallUtils';
import type { WallEndpoint } from '@/systems/map/wallUtils';
import type { TokenItem, WallSegment } from '../types';

interface MoveState {
  ids: string[];
  startWX: number;
  startWY: number;
  origins: Map<string, { x: number; y: number }>;
}

interface MarqueeState {
  startWX: number;
  startWY: number;
}

interface WallMoveState {
  mapId: string;
  indices: number[];
  startWX: number;
  startWY: number;
  originWalls: WallSegment[];
}

interface WallEndpointDrag {
  mapId: string;
  wallIndex: number;
  end: WallEndpoint;
  selectedIndices: number[];
  originWalls: WallSegment[];
}

/**
 * Owlbear-style selection tool:
 *  - click an item to select (shift to add/toggle)
 *  - drag an item to move the whole selection (snap-to-grid optional)
 *  - drag empty space to marquee-select
 *  - click empty space to clear selection
 */
export function useSelectionTool(appReady: boolean) {
  const activeTool = useMapStore((s) => s.activeTool);
  const myRole     = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!appReady || activeTool !== 'select') return;
    const app = sceneRefs.app.current;
    const overlay = sceneRefs.overlay.current;
    if (!app || !overlay) return;

    const canvas = app.canvas;
    const gm = myRole === 'GM';

    let move: MoveState | null = null;
    let wallMove: WallMoveState | null = null;
    let wallEndpoint: WallEndpointDrag | null = null;
    let marquee: MarqueeState | null = null;
    let marqueeGfx: Graphics | null = null;
    let wallHandleGfx: Graphics | null = null;

    function redrawWallHandles() {
      if (!wallHandleGfx) return;
      wallHandleGfx.clear();
      const map = getActiveMap();
      const indices = useItemStore.getState().selectedWallIndices;
      if (!map || indices.length === 0) return;
      const scale = sceneRefs.world.current?.scale.x ?? 1;
      const r = Math.max(4, 6 / scale);
      for (const h of wallHandleWorldPoints(map, indices)) {
        wallHandleGfx.circle(h.wx, h.wy, r);
        wallHandleGfx.fill({ color: 0xc9a84c, alpha: 1 });
        wallHandleGfx.setStrokeStyle({ width: 1.5, color: 0xffffff, alpha: 0.95 });
        wallHandleGfx.stroke();
      }
    }

    let cleanupHandleSub: (() => void) | undefined;
    if (gm) {
      wallHandleGfx = new Graphics();
      wallHandleGfx.label = 'wall-handles';
      overlay.addChild(wallHandleGfx);
      redrawWallHandles();
      cleanupHandleSub = useItemStore.subscribe((state, prev) => {
        if (state.selectedWallIndices !== prev.selectedWallIndices) redrawWallHandles();
      });
    }

    function selectableItems(): Item[] {
      const all = Object.values(useItemStore.getState().items) as Item[];
      if (gm) return all;
      let tokens = all.filter((i) => i.visible && i.type === 'token');
      if (!isFogOverlayVisible()) return tokens;
      const map = getActiveMap();
      if (!map) return [];
      const itemsForVision = itemsWithLiveTransforms(
        useItemStore.getState().items,
        useLiveTransformStore.getState().byId,
      );
      const userId = useSessionStore.getState().myUserId;
      const selectedIds = useItemStore.getState().selectedIds;
      if (!playerHasVisionSource(itemsForVision, userId, selectedIds, map)) {
        return [];
      }
      const seen = playerSeenCellKeys(
        useMapStore.getState().revealedCells,
        map,
        itemsForVision,
        userId,
        selectedIds,
        map.gridSize,
      );
      return tokens.filter((i) =>
        isTokenVisibleToPlayer(i as TokenItem, map, seen),
      );
    }

    function canManipulate(item: Item): boolean {
      if (item.locked) return false;
      if (gm) return true;
      return item.type === 'token';
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const store = useItemStore.getState();

      // Maps are background items: they are NOT picked by clicking their body
      // (so you can marquee tokens on top of them). Select maps via the sidebar.
      const clickable = selectableItems().filter((i) => i.type !== 'map');
      // Locked items are still selectable (so they can be unlocked) — just not movable.
      const hit = hitTest(clickable, wx, wy, { includeLocked: true });

      // Interior clicks move; only edge/corner clicks hit resize handles.
      const onHandle = !hit || !isInteriorClick(hit, wx, wy) ? pickHandle(wx, wy) : null;
      if (onHandle) return;

      function beginMove(ids: string[]) {
        const origins = new Map<string, { x: number; y: number }>();
        for (const id of ids) {
          const it = useItemStore.getState().items[id]!;
          origins.set(id, { x: it.x, y: it.y });
        }
        move = { ids, startWX: wx, startWY: wy, origins };
        canvas.setPointerCapture(e.pointerId);
      }

      function beginWallMove(map: MapItem, indices: number[]) {
        wallMove = {
          mapId: map.id,
          indices: [...indices],
          startWX: wx,
          startWY: wy,
          originWalls: (map.walls ?? []).map((w) => ({ a: { ...w.a }, b: { ...w.b } })),
        };
        canvas.setPointerCapture(e.pointerId);
      }

      function beginWallEndpoint(map: MapItem, hit: { wallIndex: number; end: WallEndpoint }, indices: number[]) {
        wallEndpoint = {
          mapId: map.id,
          wallIndex: hit.wallIndex,
          end: hit.end,
          selectedIndices: [...indices],
          originWalls: (map.walls ?? []).map((w) => ({ a: { ...w.a }, b: { ...w.b } })),
        };
        canvas.setPointerCapture(e.pointerId);
      }

      if (hit) {
        const additive = e.shiftKey;
        const alreadySelected = store.selectedIds.includes(hit.id);
        if (additive) store.select([hit.id], 'toggle');
        else if (!alreadySelected) {
          store.select([hit.id], 'set');
          store.clearWallSelection();
        }

        const ids = useItemStore.getState().selectedIds.filter((id) => {
          const it = store.items[id];
          return it && canManipulate(it);
        });
        if (ids.length) beginMove(ids);
        return;
      }

      if (gm) {
        const map = getActiveMap();
        if (map) {
          const scale = sceneRefs.world.current?.scale.x ?? 1;
          const handles = wallHandleWorldPoints(map, store.selectedWallIndices);
          const handleHit = pickWallHandle(wx, wy, handles, scale);
          if (handleHit && store.selectedWallIndices.includes(handleHit.wallIndex)) {
            beginWallEndpoint(map, handleHit, store.selectedWallIndices);
            return;
          }

          const local = worldToMapLocal(wx, wy, map);
          const wallIdx = nearestWallIndex(local.x, local.y, map.walls ?? [], WALL_PICK_RADIUS);
          if (wallIdx >= 0) {
            const alreadySelected = store.selectedWallIndices.includes(wallIdx);
            if (e.shiftKey) {
              store.selectWalls([wallIdx], 'toggle');
              redrawWallHandles();
              return;
            }
            if (!alreadySelected) {
              store.selectWalls([wallIdx], 'set');
              store.select([], 'set');
              redrawWallHandles();
            }
            const indices = useItemStore.getState().selectedWallIndices;
            if (indices.length > 0) {
              e.preventDefault();
              beginWallMove(map, indices);
            }
            return;
          }
        }
      }

      // No token/drawing/text under the cursor. If a *selected* map sits here,
      // dragging moves the current selection (lets you reposition maps).
      const mapAt = hitTestMap(selectableItems(), wx, wy);
      const selMapHere = mapAt && store.selectedIds.includes(mapAt.id) && canManipulate(mapAt);
      if (selMapHere) {
        const ids = store.selectedIds.filter((id) => {
          const it = store.items[id];
          return it && canManipulate(it);
        });
        if (ids.length) { beginMove(ids); return; }
      }

      // GM: keep sidebar-selected locked map selected when clicking its surface.
      if (gm && mapAt && store.selectedIds.includes(mapAt.id)) {
        marquee = { startWX: wx, startWY: wy };
        if (!marqueeGfx) {
          marqueeGfx = new Graphics();
          marqueeGfx.label = 'marquee';
          overlay!.addChild(marqueeGfx);
        }
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // Otherwise start a marquee.
      if (!e.shiftKey) store.clearSelection();
      marquee = { startWX: wx, startWY: wy };
      if (!marqueeGfx) {
        marqueeGfx = new Graphics();
        marqueeGfx.label = 'marquee';
        overlay!.addChild(marqueeGfx);
      }
      canvas.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);

      if (wallMove) {
        const map = useItemStore.getState().items[wallMove.mapId] as MapItem | undefined;
        if (!map) return;
        let dx = wx - wallMove.startWX;
        let dy = wy - wallMove.startWY;
        if (useItemStore.getState().snapToGrid && wallMove.indices.length > 0) {
          const leadIdx = wallMove.indices[0]!;
          const o = wallMove.originWalls[leadIdx]?.a;
          if (o) {
            const originWorld = mapLocalToWorld(o.x, o.y, map);
            const snapped = snapPoint(originWorld.x + dx, originWorld.y + dy);
            const snappedLocal = worldToMapLocal(snapped.x, snapped.y, map);
            dx = snappedLocal.x - o.x;
            dy = snappedLocal.y - o.y;
          }
        }
        const next = translateWallIndices(wallMove.originWalls, wallMove.indices, dx, dy);
        useItemStore.getState().updateItem(map.id, { walls: next });
        redrawWallHandles();
        return;
      }

      if (wallEndpoint) {
        const map = useItemStore.getState().items[wallEndpoint.mapId] as MapItem | undefined;
        if (!map) return;
        let localEnd = worldToMapLocal(wx, wy, map);
        if (useItemStore.getState().snapToGrid) {
          const snapped = snapPoint(wx, wy);
          localEnd = worldToMapLocal(snapped.x, snapped.y, map);
        }
        const next = moveWallEndpoint(
          wallEndpoint.originWalls,
          wallEndpoint.wallIndex,
          wallEndpoint.end,
          localEnd,
          wallEndpoint.selectedIndices,
        );
        useItemStore.getState().updateItem(map.id, { walls: next });
        redrawWallHandles();
        return;
      }

      if (move) {
        const snap = useItemStore.getState().snapToGrid;
        let dx = wx - move.startWX;
        let dy = wy - move.startWY;

        // Snap based on the primary selected item's origin
        if (snap && move.ids.length) {
          const lead = move.ids[0]!;
          const o = move.origins.get(lead)!;
          const snapped = snapPoint(o.x + dx, o.y + dy);
          dx = snapped.x - o.x;
          dy = snapped.y - o.y;
        }

        // Live update PixiJS containers + live transform (fog follows; store commits on pointerup).
        const layer = sceneRefs.items.current;
        const liveEntries: Array<{ id: string; patch: { x: number; y: number } }> = [];
        for (const id of move.ids) {
          const o = move.origins.get(id)!;
          const it = useItemStore.getState().items[id];
          if (!it) continue;
          const nx = o.x + dx;
          const ny = o.y + dy;
          const c = getItemContainer(layer, id);
          if (c) c.position.set(nx + it.width / 2, ny + it.height / 2);
          liveEntries.push({ id, patch: { x: nx, y: ny } });
        }
        if (liveEntries.length) useLiveTransformStore.getState().setLiveMany(liveEntries);
        return;
      }

      if (marquee && marqueeGfx) {
        const x = Math.min(marquee.startWX, wx);
        const y = Math.min(marquee.startWY, wy);
        const w = Math.abs(wx - marquee.startWX);
        const h = Math.abs(wy - marquee.startWY);
        marqueeGfx.clear();
        marqueeGfx.rect(x, y, w, h);
        marqueeGfx.fill({ color: 0xc9a84c, alpha: 0.1 });
        marqueeGfx.setStrokeStyle({ width: 1, color: 0xc9a84c, alpha: 0.8 });
        marqueeGfx.stroke();
      }
    }

    function onUp(e: PointerEvent) {
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);

      if (wallMove) {
        const wm = wallMove;
        const map = useItemStore.getState().items[wm.mapId] as MapItem | undefined;
        if (map && wallsChanged(wm.originWalls, map.walls ?? [])) {
          emitItemUpdate([{ id: map.id, patch: { walls: map.walls } }]);
        }
        wallMove = null;
      }

      if (wallEndpoint) {
        const we = wallEndpoint;
        const map = useItemStore.getState().items[we.mapId] as MapItem | undefined;
        if (map && wallsChanged(we.originWalls, map.walls ?? [])) {
          emitItemUpdate([{ id: map.id, patch: { walls: map.walls } }]);
        }
        wallEndpoint = null;
      }

      if (move) {
        const m = move;
        const snap = useItemStore.getState().snapToGrid;
        let dx = wx - m.startWX;
        let dy = wy - m.startWY;
        if (snap && m.ids.length) {
          const lead = m.ids[0]!;
          const o = m.origins.get(lead)!;
          const snapped = snapPoint(o.x + dx, o.y + dy);
          dx = snapped.x - o.x;
          dy = snapped.y - o.y;
        }
        const patches = m.ids.map((id) => {
          const o = m.origins.get(id)!;
          return { id, patch: { x: o.x + dx, y: o.y + dy } as Partial<Item> };
        });
        // Only commit if actually moved
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          useItemStore.getState().updateItems(patches);
          emitItemUpdate(patches);
        }
        useLiveTransformStore.getState().clear(m.ids);
        move = null;
      }

      if (marquee && marqueeGfx) {
        const x = Math.min(marquee.startWX, wx);
        const y = Math.min(marquee.startWY, wy);
        const w = Math.abs(wx - marquee.startWX);
        const h = Math.abs(wy - marquee.startWY);
        marqueeGfx.clear();
        if (w > 3 && h > 3) {
          const hits = selectableItems()
            .filter((it) => it.type !== 'map')
            .filter((it) => itemIntersectsRect(it, x, y, w, h))
            .map((it) => it.id);
          const mode = e.shiftKey ? 'add' : 'set';
          const itemStore = useItemStore.getState();
          itemStore.select(hits, mode);
          if (gm) {
            const map = getActiveMap();
            if (map) {
              const wallHits = wallIndicesInWorldRect(map.walls ?? [], map, x, y, w, h);
              itemStore.selectWalls(wallHits, mode);
              redrawWallHandles();
            }
          }
        }
        marquee = null;
      }
    }

    /** Double-click empty map space to select the map for move / resize (GM).
     *  Double-click a handout to view its item card. */
    function onDblClick(e: MouseEvent) {
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const clickable = selectableItems().filter((i) => i.type !== 'map');
      const onTop = hitTest(clickable, wx, wy, { includeLocked: true });

      if (onTop?.type === 'handout') {
        e.preventDefault();
        useHandoutViewerStore.getState().openHandout(onTop as HandoutItem);
        return;
      }

      if (onTop?.type === 'token' && isDdbPcToken(onTop as TokenItem) && isMobileClient()) {
        e.preventDefault();
        useDdbStore.getState().openSheet(onTop as TokenItem);
        return;
      }

      if (!gm) return;

      // Don't steal double-click from tokens / drawings on top of the map.
      if (onTop) return;

      const mapHit = hitTestMap(selectableItems(), wx, wy);
      if (!mapHit) return;

      e.preventDefault();
      move = null;
      marquee = null;
      marqueeGfx?.clear();

      const store = useItemStore.getState();
      store.setActiveMap(mapHit.id);
      store.select([mapHit.id], 'set');
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('dblclick', onDblClick);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      marqueeGfx?.destroy();
      marqueeGfx = null;
      wallHandleGfx?.destroy();
      wallHandleGfx = null;
      cleanupHandleSub?.();
    };
  }, [appReady, activeTool, myRole]);
}
