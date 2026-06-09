import { useEffect } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { sceneRefs, clientToWorld } from '../sceneRefs';
import { hitTest, hitTestMap, itemIntersectsRect, isInteriorClick } from '../hitTest';
import { snapPoint } from '../snap';
import { emitItemUpdate } from '../sceneSync';
import { getItemContainer } from '../render/useItemRenderer';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { pickHandle } from './useTransformControls';
import type { Item, HandoutItem } from '../types';
import { useHandoutViewerStore } from '@/systems/compendium/handoutViewerStore';

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
    let marquee: MarqueeState | null = null;
    let marqueeGfx: Graphics | null = null;

    function selectableItems(): Item[] {
      const all = Object.values(useItemStore.getState().items) as Item[];
      if (gm) return all;
      return all.filter((i) => i.visible && i.type === 'token');
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

      if (hit) {
        const additive = e.shiftKey;
        const alreadySelected = store.selectedIds.includes(hit.id);
        if (additive) store.select([hit.id], 'toggle');
        else if (!alreadySelected) store.select([hit.id], 'set');

        const ids = useItemStore.getState().selectedIds.filter((id) => {
          const it = store.items[id];
          return it && canManipulate(it);
        });
        if (ids.length) beginMove(ids);
        return;
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
          useItemStore.getState().select(hits, e.shiftKey ? 'add' : 'set');
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

      if (!gm) return;

      // Don't steal double-click from tokens / drawings on top of the map.
      if (onTop) return;

      const mapHit = hitTestMap(selectableItems(), wx, wy);
      if (!mapHit || !canManipulate(mapHit)) return;

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
    };
  }, [appReady, activeTool, myRole]);
}
