import { useEffect } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { isPlayerCharacterToken } from '@/systems/scene/token/clientTokenVisibility';
import { pickInteractableTokenAt } from '@/systems/scene/token/pickInteractableToken';
import { setItemDragActive } from './selectionDragState';
import { setDragLivePositions, clearDragLivePositions } from './dragLivePositions';
import { flushDeferredFogRepaint } from '@/systems/map/fogRepaintBridge';
import { useTokenDragMeasureStore } from './tokenDragMeasureStore';
import { useItemStore, getActiveMap } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { itemsWithLiveTransforms } from '../store/liveTransformStore';
import { sceneRefs, clientToWorld, pickSceneItem, getMapInteractionEl } from '../sceneRefs';
import { screenDeltaToWorldDelta } from '@/systems/map3d/coords';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { worldToGridColRow, tokenBoundsFromGrid } from '@/systems/scene/token/tokenGrid';
import { emitTokenMove } from '@/systems/scene/token/tokenSync';
import { hitTest, hitTestMap, itemIntersectsRect } from '../hitTest';
import { isTokenMoveClick } from '../token/tokenMovePick';
import { snapPoint } from '../snap';
import { emitItemUpdate } from '../sceneSync';
import { focusSessionMap } from '@/systems/map/mapFocusSync';
import { getItemContainer } from '../render/useItemRenderer';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { pickHandle } from './useTransformControls';
import type { Item, HandoutItem, MapItem } from '../types';
import { useHandoutViewerStore } from '@/systems/compendium/handoutViewerStore';
import { isMobileClient } from '@/lib/socket';
import { isDdbPcToken } from '@/systems/ddb/ddbTokenUtils';
import { useDdbStore } from '@/systems/ddb/ddbStore';
import { isAoePlacementActive } from '@/systems/combat/aoePlacementUtils';
import { worldDeltaToFeet } from '@/systems/combat/attackRange';
import { isSpellTargetPicking } from '@/systems/spells/pickSpellTargets';
import { nearestWallIndex, wallIndicesInWorldRect, wallHandleWorldPoints, pickWallHandle, translateWallIndices, moveWallEndpoint, wallsChanged, worldToMapLocal, mapLocalToWorld, WALL_PICK_RADIUS } from '@/systems/map/wallUtils';
import type { WallEndpoint } from '@/systems/map/wallUtils';
import type { TokenItem, WallSegment } from '../types';

interface MoveState {
  ids: string[];
  startWorldX: number;
  startWorldY: number;
  startScreenX: number;
  startScreenY: number;
  origins: Map<string, { x: number; y: number }>;
}

interface MarqueeState {
  startWX: number;
  startWY: number;
}

interface WallMoveState {
  mapId: string;
  indices: number[];
  startScreenX: number;
  startScreenY: number;
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
export function useSelectionTool(appReady: boolean, interactionReady = false) {
  const activeTool = useMapStore((s) => s.activeTool);
  const myRole     = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!appReady || !interactionReady || activeTool !== 'select') return;
    const app = sceneRefs.app.current;
    const overlay = sceneRefs.overlay.current;
    if (!app || !overlay) return;

    const rawInteractionEl = getMapInteractionEl();
    if (!rawInteractionEl) return;
    const interactionEl: HTMLElement = rawInteractionEl;

    function isGm(): boolean {
      return useSessionStore.getState().myRole === 'GM';
    }

    function canDragToken(item: Item): item is TokenItem {
      return item.type === 'token' && !item.locked && item.visible !== false;
    }

    function beginTokenDrag(tokenId: string, e: PointerEvent) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setItemDragActive(true);
      const store = useItemStore.getState();
      const additive = e.shiftKey;
      const alreadySelected = store.selectedIds.includes(tokenId);
      if (additive) store.select([tokenId], 'toggle');
      else if (!alreadySelected) {
        store.select([tokenId], 'set');
        store.clearWallSelection();
      }
      const ids = useItemStore.getState().selectedIds.filter((id) => {
        const it = useItemStore.getState().items[id];
        return it && canDragToken(it);
      });
      if (ids.length) beginMove(ids, e);
    }

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
    if (isGm()) {
      wallHandleGfx = new Graphics();
      wallHandleGfx.label = 'wall-handles';
      overlay.addChild(wallHandleGfx);
      redrawWallHandles();
      cleanupHandleSub = useItemStore.subscribe((state, prev) => {
        if (state.selectedWallIndices !== prev.selectedWallIndices) redrawWallHandles();
      });
    }

    function selectableItems(): Item[] {
      const store = useItemStore.getState();
      const merged = itemsWithLiveTransforms(
        store.items,
        useLiveTransformStore.getState().byId,
      );
      if (isGm()) return Object.values(merged) as Item[];
      return Object.values(merged).filter((i): i is TokenItem => canDragToken(i));
    }

    function canManipulate(item: Item): boolean {
      if (canDragToken(item)) return true;
      if (item.locked) return false;
      return isGm();
    }

    function dragWorldDelta(e: PointerEvent, startScreenX: number, startScreenY: number) {
      const scale = sceneRefs.world.current?.scale.x ?? 1;
      const { viewMode, view3dOrbit } = useMapStore.getState();
      const azimuth = viewMode === '3d' ? view3dOrbit.azimuth : 0;
      return screenDeltaToWorldDelta(
        e.clientX - startScreenX,
        e.clientY - startScreenY,
        scale,
        azimuth,
      );
    }

    function moveDragDelta(m: MoveState, e: PointerEvent): { dx: number; dy: number } {
      const scale = sceneRefs.world.current?.scale.x ?? 1;
      const { viewMode, view3dOrbit } = useMapStore.getState();
      const azimuth = viewMode === '3d' ? view3dOrbit.azimuth : 0;
      return screenDeltaToWorldDelta(
        e.clientX - m.startScreenX,
        e.clientY - m.startScreenY,
        scale,
        azimuth,
      );
    }

    function applyTokenMoveDrag(e: PointerEvent) {
      if (!move) return;
      const snap = useItemStore.getState().snapToGrid;
      const tokenOnly = moveIncludesOnlyTokens(move.ids);
      let { dx, dy } = moveDragDelta(move, e);

      // Snap maps/drawings during drag; tokens snap on release for smooth motion.
      if (snap && move.ids.length && !tokenOnly) {
        const lead = move.ids[0]!;
        const o = move.origins.get(lead)!;
        const snapped = snapPoint(o.x + dx, o.y + dy);
        dx = snapped.x - o.x;
        dy = snapped.y - o.y;
      }

      const layer = sceneRefs.items.current;
      const dragEntries: Array<{ id: string; x: number; y: number }> = [];
      const liveEntries: Array<{ id: string; patch: { x: number; y: number } }> = [];
      for (const id of move.ids) {
        const o = move.origins.get(id)!;
        const it = useItemStore.getState().items[id];
        if (!it) continue;
        const nx = o.x + dx;
        const ny = o.y + dy;
        const live = useLiveTransformStore.getState().byId[id];
        const drawW = live?.width ?? it.width;
        const drawH = live?.height ?? it.height;
        const c = getItemContainer(layer, id);
        if (c) c.position.set(nx + drawW / 2, ny + drawH / 2);
        if (it.type === 'token') {
          dragEntries.push({ id, x: nx, y: ny });
        } else {
          liveEntries.push({ id, patch: { x: nx, y: ny } });
        }
      }
      if (dragEntries.length) setDragLivePositions(dragEntries);
      if (liveEntries.length) {
        useLiveTransformStore.getState().setLiveMany(liveEntries, { bumpTick: false });
      }

      if (tokenOnly) {
        const feet = worldDeltaToFeet(dx, dy);
        scheduleMeasureUpdate(feet, e.clientX, e.clientY);
      }
    }

    function moveIncludesOnlyTokens(ids: string[]): boolean {
      return ids.length > 0 && ids.every((id) => useItemStore.getState().items[id]?.type === 'token');
    }

    function beginMove(ids: string[], e: PointerEvent) {
      setItemDragActive(true);
      const { x: startWorldX, y: startWorldY } = clientToWorld(e.clientX, e.clientY);
      const liveById = useLiveTransformStore.getState().byId;
      const origins = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const it = useItemStore.getState().items[id];
        if (!it) continue;
        const b = resolveItemBounds(it, liveById[id]);
        origins.set(id, { x: b.x, y: b.y });
      }
      move = {
        ids,
        startWorldX,
        startWorldY,
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        origins,
      };
      if (moveIncludesOnlyTokens(ids)) {
        useTokenDragMeasureStore.getState().setMeasure(0, e.clientX, e.clientY);
      } else {
        useTokenDragMeasureStore.getState().clear();
      }
      interactionEl.setPointerCapture(e.pointerId);
    }

    let measureRaf: number | null = null;
    let pendingMeasure: { feet: number; x: number; y: number } | null = null;

    function scheduleMeasureUpdate(feet: number, screenX: number, screenY: number) {
      pendingMeasure = { feet, x: screenX, y: screenY };
      if (measureRaf != null) return;
      measureRaf = requestAnimationFrame(() => {
        measureRaf = null;
        const m = pendingMeasure;
        pendingMeasure = null;
        if (m) useTokenDragMeasureStore.getState().setMeasure(m.feet, m.x, m.y);
      });
    }

    function cancelMeasureRaf() {
      if (measureRaf != null) {
        cancelAnimationFrame(measureRaf);
        measureRaf = null;
      }
      pendingMeasure = null;
    }

    function beginWallMove(map: MapItem, indices: number[], e: PointerEvent) {
      wallMove = {
        mapId: map.id,
        indices: [...indices],
        startScreenX: e.clientX,
        startScreenY: e.clientY,
        originWalls: (map.walls ?? []).map((w) => ({ a: { ...w.a }, b: { ...w.b } })),
      };
      interactionEl.setPointerCapture(e.pointerId);
    }

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      if (isAoePlacementActive()) return;
      if (isSpellTargetPicking()) return;
      // Space+drag, middle-mouse, and 3D map drag pan via useMapViewport (capture phase).
      if (e.getModifierState('Space')) return;

      const tokenPick = pickInteractableTokenAt(e.clientX, e.clientY);
      if (tokenPick && canDragToken(tokenPick)) {
        const liveById = useLiveTransformStore.getState().byId;
        const b = resolveItemBounds(tokenPick, liveById[tokenPick.id]);
        if (isTokenMoveClick(e.clientX, e.clientY, b) || !pickHandle(e.clientX, e.clientY)) {
          beginTokenDrag(tokenPick.id, e);
          return;
        }
      }

      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const store = useItemStore.getState();
      const merged = itemsWithLiveTransforms(
        store.items,
        useLiveTransformStore.getState().byId,
      );
      const viewMode = useMapStore.getState().viewMode;
      const is3dNavigate = viewMode === '3d' && !e.shiftKey;

      const selectable = selectableItems();
      const selectableIds = new Set(selectable.map((i) => i.id));
      const pick2dPool = selectable.filter((i) => i.type !== 'token');
      const liveById = useLiveTransformStore.getState().byId;

      let hit: Item | undefined;
      if (tokenPick && canDragToken(tokenPick)) {
        hit = merged[tokenPick.id] as Item;
      }

      const pickId = pickSceneItem(e.clientX, e.clientY);
      const rayHit = pickId ? merged[pickId] : undefined;
      if (!hit && rayHit?.type === 'token' && selectableIds.has(rayHit.id)) {
        hit = rayHit;
      } else if (!hit && rayHit && (!is3dNavigate || rayHit.type === 'map') && selectableIds.has(rayHit.id)) {
        hit = rayHit;
      }
      if (!hit && !is3dNavigate) {
        hit = hitTest(pick2dPool, wx, wy, { includeLocked: true }) ?? undefined;
      }

      function beginWallEndpoint(map: MapItem, hit: { wallIndex: number; end: WallEndpoint }, indices: number[]) {
        wallEndpoint = {
          mapId: map.id,
          wallIndex: hit.wallIndex,
          end: hit.end,
          selectedIndices: [...indices],
          originWalls: (map.walls ?? []).map((w) => ({ a: { ...w.a }, b: { ...w.b } })),
        };
        interactionEl.setPointerCapture(e.pointerId);
      }

      if (hit) {
        const additive = e.shiftKey;
        const alreadySelected = store.selectedIds.includes(hit.id);
        if (additive) store.select([hit.id], 'toggle');
        else if (!alreadySelected) {
          store.select([hit.id], 'set');
          store.clearWallSelection();
        }

        const freshStore = useItemStore.getState();
        const freshIds = freshStore.selectedIds.filter((id) => {
          const it = freshStore.items[id];
          return it && canManipulate(it);
        });

        if (freshIds.length) {
          if (hit.type === 'token' && canDragToken(hit)) {
            const b = resolveItemBounds(hit, liveById[hit.id]);
            if (isTokenMoveClick(e.clientX, e.clientY, b) || !pickHandle(e.clientX, e.clientY)) {
              beginTokenDrag(hit.id, e);
            }
          } else {
            let handleConsumed = false;
            if (isGm()) {
              if (pickHandle(e.clientX, e.clientY)) handleConsumed = true;
            }
            if (!handleConsumed && !is3dNavigate) {
              e.preventDefault();
              e.stopImmediatePropagation();
              beginMove(freshIds, e);
            }
          }
        }
        return;
      }

      if (isGm() && pickHandle(e.clientX, e.clientY)) return;

      if (isGm() && !is3dNavigate) {
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
              beginWallMove(map, indices, e);
            }
            return;
          }
        }
      }

      // GM: 3D map pick volume or ground hit selects the map (2D / Shift+drag only).
      if (!hit && isGm() && !is3dNavigate) {
        const pickId = pickSceneItem(e.clientX, e.clientY);
        const pickedItem = pickId ? merged[pickId] : undefined;
        const mapHit = pickedItem?.type === 'map'
          ? pickedItem
          : hitTestMap(selectableItems(), wx, wy);
        if (mapHit) {
          const additive = e.shiftKey;
          const alreadySelected = store.selectedIds.includes(mapHit.id);
          if (additive) store.select([mapHit.id], 'toggle');
          else if (!alreadySelected) {
            store.select([mapHit.id], 'set');
            store.clearWallSelection();
          }
          if (canManipulate(mapHit) && useItemStore.getState().selectedIds.includes(mapHit.id)) {
            const ids = useItemStore.getState().selectedIds.filter((id) => {
              const it = store.items[id];
              return it && canManipulate(it);
            });
            if (ids.length) beginMove(ids, e);
          }
          return;
        }
      }

      // GM: click map in 3D to select it (resize via gizmo; drag-to-pan uses threshold in useMapViewport).
      if (!hit && isGm() && is3dNavigate) {
        const pickId3d = pickSceneItem(e.clientX, e.clientY);
        const pickedItem = pickId3d ? merged[pickId3d] : undefined;
        const mapHit = pickedItem?.type === 'map'
          ? pickedItem
          : hitTestMap(selectableItems(), wx, wy);
        if (mapHit) {
          const additive = e.shiftKey;
          const alreadySelected = store.selectedIds.includes(mapHit.id);
          if (additive) store.select([mapHit.id], 'toggle');
          else if (!alreadySelected) {
            store.select([mapHit.id], 'set');
            store.clearWallSelection();
          }
          return;
        }
      }

      // Empty drag: marquee select — in 3D, plain drag pans (useMapViewport); Shift+drag marquees.
      if (is3dNavigate && !e.shiftKey) return;

      if (!e.shiftKey) {
        store.clearSelection();
      }
      marquee = { startWX: wx, startWY: wy };
      if (!marqueeGfx) {
        marqueeGfx = new Graphics();
        marqueeGfx.label = 'marquee';
        overlay!.addChild(marqueeGfx);
      }
      interactionEl.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (isAoePlacementActive()) return;
      if (move) {
        e.preventDefault();
        e.stopImmediatePropagation();
        applyTokenMoveDrag(e);
        return;
      }

      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);

      if (wallMove) {
        const map = useItemStore.getState().items[wallMove.mapId] as MapItem | undefined;
        if (!map) return;
        let { dx, dy } = dragWorldDelta(e, wallMove.startScreenX, wallMove.startScreenY);
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
      if (move) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
      if (move) {
        // handled below
      } else {
        setItemDragActive(false);
      }
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
        applyTokenMoveDrag(e);
        const m = move;
        const snap = useItemStore.getState().snapToGrid;
        let { dx, dy } = moveDragDelta(m, e);
        if (snap && m.ids.length) {
          const lead = m.ids[0]!;
          const o = m.origins.get(lead)!;
          const snapped = snapPoint(o.x + dx, o.y + dy);
          dx = snapped.x - o.x;
          dy = snapped.y - o.y;
        }
        const patches = m.ids.map((id) => {
          const o = m.origins.get(id)!;
          const nx = o.x + dx;
          const ny = o.y + dy;
          const it = useItemStore.getState().items[id];
          if (it?.type === 'token') {
            const { gridCol, gridRow } = worldToGridColRow(nx + it.width / 2, ny + it.height / 2);
            return { id, kind: 'token' as const, gridCol, gridRow, x: nx, y: ny };
          }
          return { id, kind: 'item' as const, patch: { x: nx, y: ny } as Partial<Item> };
        });
        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          const myUserId = useSessionStore.getState().myUserId?.trim() ?? '';
          const claimOwner = !isGm() && myUserId;
          for (const p of patches) {
            if (p.kind === 'token') {
              const it = useItemStore.getState().items[p.id] as TokenItem | undefined;
              if (!it || it.type !== 'token') continue;
              if (claimOwner && isPlayerCharacterToken(it) && !it.ownerId?.trim()) {
                useItemStore.getState().updateItem(p.id, { ownerId: myUserId, isPc: true });
                emitItemUpdate([{ id: p.id, patch: { ownerId: myUserId, isPc: true } }]);
              }
              if (snap) {
                const bounds = tokenBoundsFromGrid(it, p.gridCol, p.gridRow);
                emitTokenMove(p.id, bounds.gridCol, bounds.gridRow, bounds.x, bounds.y);
              } else {
                emitTokenMove(p.id, p.gridCol, p.gridRow, p.x, p.y);
              }
            }
          }
          const itemPatches = patches
            .filter((p): p is { id: string; kind: 'item'; patch: Partial<Item> } => p.kind === 'item')
            .map(({ id, patch }) => ({ id, patch }));
          if (itemPatches.length) {
            useItemStore.getState().updateItems(itemPatches);
            emitItemUpdate(itemPatches);
          }
        }
        clearDragLivePositions(m.ids);
        useLiveTransformStore.getState().clear(m.ids);
        move = null;
        setItemDragActive(false);
        flushDeferredFogRepaint();
        cancelMeasureRaf();
        useTokenDragMeasureStore.getState().clear();
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
          if (isGm()) {
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

      if (!isGm()) return;

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
      if (isGm()) focusSessionMap(mapHit.id, { fitToMap: false, select: false, emit: true });
      store.select([mapHit.id], 'set');
    }

    const captureOpts = { capture: true, passive: false } as AddEventListenerOptions;
    interactionEl.addEventListener('pointerdown', onDown, captureOpts);
    interactionEl.addEventListener('dblclick', onDblClick);
    interactionEl.addEventListener('pointermove', onMove, captureOpts);
    interactionEl.addEventListener('pointerup', onUp, captureOpts);
    interactionEl.addEventListener('pointercancel', onUp, captureOpts);

    return () => {
      if (move) clearDragLivePositions(move.ids);
      cancelMeasureRaf();
      setItemDragActive(false);
      flushDeferredFogRepaint();
      useTokenDragMeasureStore.getState().clear();
      interactionEl.removeEventListener('pointerdown', onDown, captureOpts);
      interactionEl.removeEventListener('dblclick', onDblClick);
      interactionEl.removeEventListener('pointermove', onMove, captureOpts);
      interactionEl.removeEventListener('pointerup', onUp, captureOpts);
      interactionEl.removeEventListener('pointercancel', onUp, captureOpts);
      marqueeGfx?.destroy();
      marqueeGfx = null;
      wallHandleGfx?.destroy();
      wallHandleGfx = null;
      cleanupHandleSub?.();
    };
  }, [appReady, interactionReady, activeTool, myRole]);
}
