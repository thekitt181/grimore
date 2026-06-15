import { useEffect } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { sceneRefs, clientToWorld, getMapInteractionEl } from '../sceneRefs';
import { sceneCameraRef } from '@/systems/map3d/sceneCameraRef';
import { getPickCanvasRect } from '@/systems/map3d/pickCamera';
import { worldXZToClientScreen } from '@/systems/map3d/perspectiveCameraSync';
import { snapAngle, snapSize } from '../snap';
import { emitItemUpdate } from '../sceneSync';
import { emitTokenRotate } from '../token/tokenSync';
import { getItemContainer } from '../render/useItemRenderer';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { resizeFromCenter } from '../resizeFromCenter';
import { isInteriorClick } from '../hitTest';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { worldToGridColRow } from '../token/tokenGrid';
import type { Item, TokenItem } from '../types';

import type { TokenGizmoLayout, GizmoHandle } from '../token/tokenGizmoLayout';

// ─── Handle registry (shared with selection tool) ──────────────────────────────

type HandleId = GizmoHandle['id'];

interface HandleDesc {
  id: HandleId;
  wx: number; wy: number;
  sx: number; sy: number;
}

interface HandleRegistry {
  mode: 'none' | 'single' | 'group';
  itemId: string | undefined;
  handles: HandleDesc[];
}

const registry: HandleRegistry = { mode: 'none', itemId: undefined, handles: [] };

/** Read-only handle positions for debugging. */
export function getTransformHandleRegistry(): Readonly<HandleRegistry> {
  return registry;
}

/** Sync pick registry from the shared gizmo layout (Three.js is source of truth). */
export function syncTransformHandleRegistry(layout: TokenGizmoLayout): void {
  registry.mode = layout.mode;
  registry.itemId = layout.itemId;
  registry.handles = layout.handles.map((h) => ({ ...h }));
}

/** Picks a transform handle near the pointer (screen space in 3D, world space in 2D). */
export function pickHandle(clientX: number, clientY: number): HandleDesc | null {
  if (registry.mode === 'none' || registry.handles.length === 0) return null;
  const viewMode = useMapStore.getState().viewMode;
  const item = registry.itemId
    ? useItemStore.getState().items[registry.itemId]
    : undefined;
  const { x: wx, y: wy } = clientToWorld(clientX, clientY);
  // In 2D, interior clicks prefer move over edge handles; 3D uses screen-space handle pick.
  if (item && viewMode !== '3d' && isInteriorClick(item, wx, wy)) return null;

  const scale = sceneRefs.world.current?.scale.x ?? 1;
  const minDim = item ? Math.min(item.width, item.height) : 64;
  const tol = viewMode === '3d'
    ? Math.max(14, Math.min(minDim * 0.14, 42))
    : Math.max(10 / scale, Math.min(minDim * 0.12, 24));

  const rect = getPickCanvasRect();
  const useScreen = viewMode === '3d' && rect && sceneCameraRef.liveCamera;

  let best: HandleDesc | null = null;
  let bestD = tol * tol;
  for (const h of registry.handles) {
    let d: number;
    if (useScreen) {
      const projected = worldXZToClientScreen(h.wx, h.wy, rect);
      if (!projected) continue;
      d = (clientX - projected.x) ** 2 + (clientY - projected.y) ** 2;
    } else {
      const dx = wx - h.wx;
      const dy = wy - h.wy;
      d = dx * dx + dy * dy;
    }
    if (d <= bestD) { bestD = d; best = h; }
  }
  return best;
}

// ─── Math helpers ──────────────────────────────────────────────────────────────

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

const MIN = 16;

function aspectLocked(item: Item): boolean {
  return item.type === 'map' || item.type === 'token' || item.type === 'handout';
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTransformControls(appReady: boolean) {
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items       = useItemStore((s) => s.items);
  const activeTool  = useMapStore((s) => s.activeTool);
  const myRole      = useSessionStore((s) => s.myRole);

  useEffect(() => {
    if (!appReady) return;
    const overlay = sceneRefs.overlay.current;
    const app = sceneRefs.app.current;
    if (!overlay || !app) return;

    // Build / fetch the graphics objects
    let box = overlay.getChildByLabel('xf-box') as Graphics | null;
    if (!box) { box = new Graphics(); box.label = 'xf-box'; overlay.addChild(box); }
    let handlesG = overlay.getChildByLabel('xf-handles') as Graphics | null;
    if (!handlesG) { handlesG = new Graphics(); handlesG.label = 'xf-handles'; overlay.addChild(handlesG); }

    function hidePixiControls() {
      box!.visible = false;
      handlesG!.visible = false;
      box!.clear();
      handlesG!.clear();
    }

    hidePixiControls();

    const gm = myRole === 'GM';
    const sel = selectedIds.map((id) => items[id]).filter(Boolean) as Item[];
    const manipulable = sel.filter((it) => {
      if (it.locked) return false;
      if (gm) return true;
      return it.type === 'token';
    });

    if (activeTool !== 'select' || manipulable.length === 0) {
      return;
    }

    // Registry + gizmo visuals: Pixi in 2D (usePixiSelectionGizmo), Three in 3D (Map3DTokenGizmo).
    const canvas = getMapInteractionEl() ?? app.canvas;

    interface DragState {
      handle: HandleDesc;
      // single
      item?: Item;
      anchorWX?: number; anchorWY?: number;
      cx0?: number; cy0?: number;
      w0?: number; h0?: number; rot0?: number;
      // group
      groupMinX?: number; groupMinY?: number; groupMaxX?: number; groupMaxY?: number;
      groupAnchorX?: number; groupAnchorY?: number;
      origins?: Map<string, { x: number; y: number; w: number; h: number }>;
    }
    let drag: DragState | null = null;

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const h = pickHandle(e.clientX, e.clientY);
      if (!h) return; // not on a handle — selection tool handles it
      e.stopPropagation();

      if (registry.mode === 'single' && registry.itemId) {
        const it = useItemStore.getState().items[registry.itemId];
        if (!it) return;
        const live = useLiveTransformStore.getState().byId[it.id];
        const b = resolveItemBounds(it, live);
        const cx0 = b.cx;
        const cy0 = b.cz;
        if (it.type === 'map') {
          drag = { handle: h, item: it, cx0, cy0, w0: b.width, h0: b.height, rot0: b.rotation };
        } else {
          const aLocal = { x: -h.sx * (b.width / 2), y: -h.sy * (b.height / 2) };
          const aRot = rot(aLocal.x, aLocal.y, b.rotation);
          drag = {
            handle: h,
            item: it,
            anchorWX: cx0 + aRot.x,
            anchorWY: cy0 + aRot.y,
            cx0,
            cy0,
            w0: b.width,
            h0: b.height,
            rot0: b.rotation,
          };
        }
      } else if (registry.mode === 'group') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const origins = new Map<string, { x: number; y: number; w: number; h: number }>();
        const liveById = useLiveTransformStore.getState().byId;
        for (const it of manipulable) {
          const b = resolveItemBounds(it, liveById[it.id]);
          minX = Math.min(minX, b.x);
          minY = Math.min(minY, b.y);
          maxX = Math.max(maxX, b.x + b.width);
          maxY = Math.max(maxY, b.y + b.height);
          origins.set(it.id, { x: b.x, y: b.y, w: b.width, h: b.height });
        }
        // Anchor = opposite corner
        const anchorX = h.sx > 0 ? minX : maxX;
        const anchorY = h.sy > 0 ? minY : maxY;
        drag = { handle: h, groupMinX: minX, groupMinY: minY, groupMaxX: maxX, groupMaxY: maxY, groupAnchorX: anchorX, groupAnchorY: anchorY, origins };
      }
      canvas.setPointerCapture(e.pointerId);
    }

    function onMove(e: PointerEvent) {
      if (!drag) return;
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const snap = useItemStore.getState().snapToGrid;
      const layer = sceneRefs.items.current;

      if (registry.mode === 'single' && drag.item) {
        const it = drag.item;

        if (drag.handle.id === 'rotate') {
          let deg = (Math.atan2(wy - drag.cy0!, wx - drag.cx0!) * 180) / Math.PI + 90;
          if (snap) deg = snapAngle(deg);
          const c = it.type !== 'token' ? getItemContainer(layer, it.id) : null;
          if (c) c.rotation = (deg * Math.PI) / 180;
          (drag as DragState & { _deg?: number })._deg = deg;
          useLiveTransformStore.getState().setLive(it.id, { rotation: deg });
          return;
        }

        const { sx, sy } = drag.handle;

        let newW: number, newH: number, nx: number, ny: number, cx: number, cy: number;

        if (it.type === 'map') {
          const r = resizeFromCenter(it, drag.cx0!, drag.cy0!, wx, wy, sx, sy, {
            minSize: MIN, snap, aspectLock: true,
          });
          newW = r.width; newH = r.height; nx = r.x; ny = r.y;
          cx = drag.cx0!; cy = drag.cy0!;
        } else {
          const w0 = drag.w0 ?? it.width;
          const h0 = drag.h0 ?? it.height;
          const rot0 = drag.rot0 ?? it.rotation;
          // Tokens / drawings: anchor opposite corner/edge
          const rel = rot(wx - drag.anchorWX!, wy - drag.anchorWY!, -rot0);
          newW = sx === 0 ? w0 : Math.max(MIN, rel.x / sx);
          newH = sy === 0 ? h0 : Math.max(MIN, rel.y / sy);

          if (aspectLocked(it)) {
            const ratio = w0 / h0;
            if (sx !== 0 && sy !== 0) {
              const sca = Math.max(newW / w0, newH / h0);
              newW = w0 * sca; newH = h0 * sca;
            } else if (sx !== 0) { newH = newW / ratio; }
            else { newW = newH * ratio; }
          }
          if (snap) {
            if (sx !== 0) newW = snapSize(newW);
            if (sy !== 0) newH = snapSize(newH);
          }

          const half = rot(sx * (newW / 2), sy * (newH / 2), rot0);
          cx = drag.anchorWX! + half.x;
          cy = drag.anchorWY! + half.y;
          nx = cx - newW / 2;
          ny = cy - newH / 2;
        }

        (drag as DragState & { _w?: number; _h?: number; _x?: number; _y?: number })._w = newW;
        (drag as DragState & { _w?: number; _h?: number; _x?: number; _y?: number })._h = newH;
        (drag as DragState & { _w?: number; _h?: number; _x?: number; _y?: number })._x = nx;
        (drag as DragState & { _w?: number; _h?: number; _x?: number; _y?: number })._y = ny;

        if (it.type !== 'token') {
          const c = getItemContainer(layer, it.id);
          if (c) {
            c.pivot.set(it.width / 2, it.height / 2);
            c.position.set(cx, cy);
            c.scale.set(newW / it.width, newH / it.height);
          }
        }
        useLiveTransformStore.getState().setLive(it.id, { x: nx, y: ny, width: newW, height: newH });
        return;
      }

      if (registry.mode === 'group' && drag.origins) {
        const aX = drag.groupAnchorX!, aY = drag.groupAnchorY!;
        const w0 = drag.groupMaxX! - drag.groupMinX!;
        const h0 = drag.groupMaxY! - drag.groupMinY!;
        let scaleX = Math.abs(wx - aX) / (w0 || 1);
        let scaleY = Math.abs(wy - aY) / (h0 || 1);
        const s = Math.max(0.1, Math.max(scaleX, scaleY)); // uniform
        (drag as DragState & { _scale?: number })._scale = s;
        const liveEntries: Array<{ id: string; patch: { x: number; y: number; width: number; height: number } }> = [];
        for (const [id, o] of drag.origins) {
          const nx = aX + (o.x - aX) * s;
          const ny = aY + (o.y - aY) * s;
          const nw = o.w * s;
          const nh = o.h * s;
          liveEntries.push({ id, patch: { x: nx, y: ny, width: nw, height: nh } });
          const it = useItemStore.getState().items[id];
          if (it?.type !== 'token') {
            const c = getItemContainer(layer, id);
            if (c) {
              c.pivot.set(o.w / 2, o.h / 2);
              c.position.set(nx + nw / 2, ny + nh / 2);
              c.scale.set(s, s);
            }
          }
        }
        useLiveTransformStore.getState().setLiveMany(liveEntries);
      }
    }

    function onUp() {
      if (!drag) return;
      const layer = sceneRefs.items.current;
      const liveStore = useLiveTransformStore.getState();
      const clearedIds: string[] = [];

      if (registry.mode === 'single' && drag.item) {
        const it = drag.item;
        if (drag.handle.id === 'rotate') {
          const deg = (drag as DragState & { _deg?: number })._deg ?? it.rotation;
          if (it.type === 'token') {
            emitTokenRotate(it.id, deg);
          } else {
            useItemStore.getState().updateItem(it.id, { rotation: deg });
            emitItemUpdate([{ id: it.id, patch: { rotation: deg } }]);
          }
          clearedIds.push(it.id);
        } else if ((drag as DragState & { _w?: number })._w) {
          const newW = (drag as DragState & { _w?: number; _h?: number; _x?: number; _y?: number })._w!;
          const newH = (drag as DragState & { _h?: number })._h!;
          const nx = (drag as DragState & { _x?: number })._x!;
          const ny = (drag as DragState & { _y?: number })._y!;
          const patch: Partial<Item> = { x: nx, y: ny, width: newW, height: newH } as Partial<Item>;
          if (it.type === 'token') {
            const token = it as TokenItem;
            const cellPx = token.width / token.sizeCells;
            const sizeCells = Math.max(0.25, newW / cellPx);
            const tokenPatch = patch as Partial<TokenItem>;
            tokenPatch.sizeCells = sizeCells;
            if (aspectLocked(it)) {
              tokenPatch.width = newW;
              tokenPatch.height = newW;
            }
            const finalW = tokenPatch.width ?? newW;
            const finalH = tokenPatch.height ?? newH;
            const grid = worldToGridColRow(nx + finalW / 2, ny + finalH / 2);
            tokenPatch.gridCol = grid.gridCol;
            tokenPatch.gridRow = grid.gridRow;
          }
          if (it.type !== 'token') {
            const c = getItemContainer(layer, it.id);
            if (c) c.scale.set(1, 1);
          }
          useItemStore.getState().updateItem(it.id, patch);
          emitItemUpdate([{ id: it.id, patch }]);
          clearedIds.push(it.id);
        }
      } else if (registry.mode === 'group' && drag.origins) {
        const s = (drag as DragState & { _scale?: number })._scale ?? 1;
        const aX = drag.groupAnchorX!, aY = drag.groupAnchorY!;
        const patches: Array<{ id: string; patch: Partial<Item> }> = [];
        for (const [id, o] of drag.origins) {
          const nx = aX + (o.x - aX) * s;
          const ny = aY + (o.y - aY) * s;
          patches.push({ id, patch: { x: nx, y: ny, width: o.w * s, height: o.h * s } as Partial<Item> });
          const it = useItemStore.getState().items[id];
          if (it?.type !== 'token') {
            const c = getItemContainer(layer, id);
            if (c) c.scale.set(1, 1);
          }
          clearedIds.push(id);
        }
        useItemStore.getState().updateItems(patches);
        emitItemUpdate(patches);
      }
      if (clearedIds.length) liveStore.clear(clearedIds);
      drag = null;
    }

    canvas.addEventListener('pointerdown', onDown, true);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown, true);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [appReady, selectedIds, items, activeTool, myRole]);
}
