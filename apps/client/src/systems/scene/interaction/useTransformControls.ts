import { useEffect } from 'react';
import { Graphics } from 'pixi.js';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '../store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { sceneRefs, clientToWorld } from '../sceneRefs';
import { snapAngle, snapSize } from '../snap';
import { emitItemUpdate } from '../sceneSync';
import { getItemContainer } from '../render/useItemRenderer';
import { useLiveTransformStore } from '../store/liveTransformStore';
import { resizeFromCenter } from '../resizeFromCenter';
import { isInteriorClick } from '../hitTest';
import type { Item } from '../types';

// ─── Handle registry (shared with selection tool) ──────────────────────────────

type HandleId = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | 'rotate';

interface HandleDesc {
  id: HandleId;
  wx: number; wy: number;   // world position
  sx: number; sy: number;   // local sign direction (corner/edge)
}

interface HandleRegistry {
  mode: 'none' | 'single' | 'group';
  itemId: string | undefined;
  handles: HandleDesc[];
}

const registry: HandleRegistry = { mode: 'none', itemId: undefined, handles: [] };

/** Picks a transform handle near a world point (tight hit area; interior clicks excluded). */
export function pickHandle(wx: number, wy: number): HandleDesc | null {
  const scale = sceneRefs.world.current?.scale.x ?? 1;
  const item = registry.itemId
    ? useItemStore.getState().items[registry.itemId]
    : undefined;
  if (item && isInteriorClick(item, wx, wy)) return null;

  const minDim = item ? Math.min(item.width, item.height) : 64;
  const tol = Math.min(7 / scale, minDim * 0.1);

  let best: HandleDesc | null = null;
  let bestD = tol * tol;
  for (const h of registry.handles) {
    const dx = wx - h.wx, dy = wy - h.wy;
    const d = dx * dx + dy * dy;
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
const HANDLE = 10;
const ROT_DIST = 28;

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

    const gm = myRole === 'GM';
    const sel = selectedIds.map((id) => items[id]).filter(Boolean) as Item[];
    const manipulable = sel.filter((it) => {
      if (it.locked) return false;
      if (gm) return true;
      return it.type === 'token';
    });

    function clearControls() {
      registry.mode = 'none';
      registry.handles = [];
      box!.clear();
      handlesG!.clear();
    }

    // Only show transform UI with the select tool and an unlocked selection
    if (activeTool !== 'select' || manipulable.length === 0) {
      clearControls();
      return;
    }

    const scale = sceneRefs.world.current?.scale.x ?? 1;

    function handleHalfSize(it: Item): number {
      const minDim = Math.min(it.width, it.height);
      if (minDim < 96) return Math.min(5 / scale, minDim * 0.07);
      return HANDLE / scale / 2;
    }

    function drawHandleSquare(wx: number, wy: number, hs: number) {
      handlesG!.rect(wx - hs, wy - hs, hs * 2, hs * 2);
    }

    function drawSingleItemControls(
      it: Item,
      cx: number,
      cy: number,
      w: number,
      h: number,
      rebuildRegistry: boolean,
    ) {
      if (rebuildRegistry) {
        box!.clear();
        handlesG!.clear();
        registry.handles = [];
        registry.mode = 'single';
        registry.itemId = it.id;
      } else {
        box!.clear();
        handlesG!.clear();
      }

      const hw = w / 2;
      const hh = h / 2;
      const toWorld = (lx: number, ly: number) => {
        const r = rot(lx, ly, it.rotation);
        return { x: cx + r.x, y: cy + r.y };
      };
      const corners = {
        nw: toWorld(-hw, -hh), ne: toWorld(hw, -hh),
        se: toWorld(hw, hh),   sw: toWorld(-hw, hh),
      };
      box!.setStrokeStyle({ width: 2 / scale, color: 0xc9a84c, alpha: 0.9 });
      box!.moveTo(corners.nw.x, corners.nw.y);
      box!.lineTo(corners.ne.x, corners.ne.y);
      box!.lineTo(corners.se.x, corners.se.y);
      box!.lineTo(corners.sw.x, corners.sw.y);
      box!.lineTo(corners.nw.x, corners.nw.y);
      box!.stroke();

      const minDim = Math.min(w, h);
      const compact = minDim < 96;
      const hs = handleHalfSize({ ...it, width: w, height: h });
      const defs: Array<[HandleId, number, number]> = compact
        ? [['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1]]
        : [
            ['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1],
            ['n', 0, -1], ['e', 1, 0], ['s', 0, 1], ['w', -1, 0],
          ];
      handlesG!.setStrokeStyle({ width: 1 / scale, color: 0x0a0a0f, alpha: 1 });
      for (const [id, sx, sy] of defs) {
        const pt = toWorld(sx * hw, sy * hh);
        if (rebuildRegistry) registry.handles.push({ id, wx: pt.x, wy: pt.y, sx, sy });
        else {
          const hnd = registry.handles.find((x) => x.id === id);
          if (hnd) { hnd.wx = pt.x; hnd.wy = pt.y; }
        }
        drawHandleSquare(pt.x, pt.y, hs);
      }
      const rotDist = compact ? Math.max(ROT_DIST / scale, minDim * 0.55) : ROT_DIST / scale;
      const rotPt = toWorld(0, -hh - rotDist);
      const topMid = toWorld(0, -hh);
      if (rebuildRegistry) {
        registry.handles.push({ id: 'rotate', wx: rotPt.x, wy: rotPt.y, sx: 0, sy: 0 });
      } else {
        const hnd = registry.handles.find((x) => x.id === 'rotate');
        if (hnd) { hnd.wx = rotPt.x; hnd.wy = rotPt.y; }
      }
      box!.setStrokeStyle({ width: 1.5 / scale, color: 0xc9a84c, alpha: 0.8 });
      box!.moveTo(topMid.x, topMid.y);
      box!.lineTo(rotPt.x, rotPt.y);
      box!.stroke();
      handlesG!.fill({ color: 0xc9a84c });
      handlesG!.circle(rotPt.x, rotPt.y, hs * 1.2);
      handlesG!.fill({ color: 0xc9a84c });
    }

    function redraw() {
      box!.clear();
      handlesG!.clear();
      registry.handles = [];

      if (manipulable.length === 1) {
        const it = manipulable[0]!;
        drawSingleItemControls(
          it, it.x + it.width / 2, it.y + it.height / 2, it.width, it.height, true,
        );
      } else {
        // Group — axis-aligned box, 4 corner handles, proportional scale
        registry.mode = 'group';
        registry.itemId = undefined;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const it of manipulable) {
          minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
          maxX = Math.max(maxX, it.x + it.width); maxY = Math.max(maxY, it.y + it.height);
        }
        box!.setStrokeStyle({ width: 2 / scale, color: 0xc9a84c, alpha: 0.9 });
        box!.rect(minX, minY, maxX - minX, maxY - minY);
        box!.stroke();
        const defs: Array<[HandleId, number, number]> = [
          ['nw', minX, minY], ['ne', maxX, minY], ['se', maxX, maxY], ['sw', minX, maxY],
        ];
        handlesG!.setStrokeStyle({ width: 1 / scale, color: 0x0a0a0f, alpha: 1 });
        const groupHs = HANDLE / scale / 2;
        for (const [id, x, y] of defs) {
          const sx = id === 'nw' || id === 'sw' ? -1 : 1;
          const sy = id === 'nw' || id === 'ne' ? -1 : 1;
          registry.handles.push({ id, wx: x, wy: y, sx, sy });
          drawHandleSquare(x, y, groupHs);
        }
      }
      handlesG!.fill({ color: 0xc9a84c });
    }

    redraw();

    // ── Drag handling ─────────────────────────────────────────────────────────
    const canvas = app.canvas;

    interface DragState {
      handle: HandleDesc;
      // single
      item?: Item;
      anchorWX?: number; anchorWY?: number;
      cx0?: number; cy0?: number;
      // group
      groupMinX?: number; groupMinY?: number; groupMaxX?: number; groupMaxY?: number;
      groupAnchorX?: number; groupAnchorY?: number;
      origins?: Map<string, { x: number; y: number; w: number; h: number }>;
    }
    let drag: DragState | null = null;

    function onDown(e: PointerEvent) {
      if (e.button !== 0) return;
      const { x: wx, y: wy } = clientToWorld(e.clientX, e.clientY);
      const h = pickHandle(wx, wy);
      if (!h) return; // not on a handle — selection tool handles it
      e.stopPropagation();

      if (registry.mode === 'single' && registry.itemId) {
        const it = useItemStore.getState().items[registry.itemId];
        if (!it) return;
        const cx0 = it.x + it.width / 2;
        const cy0 = it.y + it.height / 2;
        if (it.type === 'map') {
          // Maps resize from center so they don't drift upward/sideways.
          drag = { handle: h, item: it, cx0, cy0 };
        } else {
          const aLocal = { x: -h.sx * (it.width / 2), y: -h.sy * (it.height / 2) };
          const aRot = rot(aLocal.x, aLocal.y, it.rotation);
          drag = { handle: h, item: it, anchorWX: cx0 + aRot.x, anchorWY: cy0 + aRot.y, cx0, cy0 };
        }
      } else if (registry.mode === 'group') {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        const origins = new Map<string, { x: number; y: number; w: number; h: number }>();
        for (const it of manipulable) {
          minX = Math.min(minX, it.x); minY = Math.min(minY, it.y);
          maxX = Math.max(maxX, it.x + it.width); maxY = Math.max(maxY, it.y + it.height);
          origins.set(it.id, { x: it.x, y: it.y, w: it.width, h: it.height });
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
          const c = getItemContainer(layer, it.id);
          if (c) c.rotation = (deg * Math.PI) / 180;
          (drag as any)._deg = deg;
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
          // Tokens / drawings: anchor opposite corner/edge
          const rel = rot(wx - drag.anchorWX!, wy - drag.anchorWY!, -it.rotation);
          newW = sx === 0 ? it.width  : Math.max(MIN, rel.x / sx);
          newH = sy === 0 ? it.height : Math.max(MIN, rel.y / sy);

          if (aspectLocked(it)) {
            const ratio = it.width / it.height;
            if (sx !== 0 && sy !== 0) {
              const sca = Math.max(newW / it.width, newH / it.height);
              newW = it.width * sca; newH = it.height * sca;
            } else if (sx !== 0) { newH = newW / ratio; }
            else { newW = newH * ratio; }
          }
          if (snap) {
            if (sx !== 0) newW = snapSize(newW);
            if (sy !== 0) newH = snapSize(newH);
          }

          const half = rot(sx * (newW / 2), sy * (newH / 2), it.rotation);
          cx = drag.anchorWX! + half.x;
          cy = drag.anchorWY! + half.y;
          nx = cx - newW / 2;
          ny = cy - newH / 2;
        }

        (drag as any)._w = newW; (drag as any)._h = newH;
        (drag as any)._x = nx;   (drag as any)._y = ny;

        const c = getItemContainer(layer, it.id);
        if (c) {
          // Pivot at content center (original size); scale outward from fixed center.
          c.pivot.set(it.width / 2, it.height / 2);
          c.position.set(cx, cy);
          c.scale.set(newW / it.width, newH / it.height);
        }
        drawSingleItemControls(it, cx, cy, newW, newH, false);
        return;
      }

      if (registry.mode === 'group' && drag.origins) {
        const aX = drag.groupAnchorX!, aY = drag.groupAnchorY!;
        const w0 = drag.groupMaxX! - drag.groupMinX!;
        const h0 = drag.groupMaxY! - drag.groupMinY!;
        let scaleX = Math.abs(wx - aX) / (w0 || 1);
        let scaleY = Math.abs(wy - aY) / (h0 || 1);
        const s = Math.max(0.1, Math.max(scaleX, scaleY)); // uniform
        (drag as any)._scale = s;
        for (const [id, o] of drag.origins) {
          const c = getItemContainer(layer, id);
          if (!c) continue;
          const nx = aX + (o.x - aX) * s;
          const ny = aY + (o.y - aY) * s;
          const nw = o.w * s, nh = o.h * s;
          c.pivot.set(o.w / 2, o.h / 2);
          c.position.set(nx + nw / 2, ny + nh / 2);
          c.scale.set(s, s);
        }
      }
    }

    function onUp() {
      if (!drag) return;
      const layer = sceneRefs.items.current;

      if (registry.mode === 'single' && drag.item) {
        const it = drag.item;
        if (drag.handle.id === 'rotate') {
          const deg = (drag as any)._deg ?? it.rotation;
          useItemStore.getState().updateItem(it.id, { rotation: deg });
          emitItemUpdate([{ id: it.id, patch: { rotation: deg } }]);
          useLiveTransformStore.getState().clear([it.id]);
        } else if ((drag as any)._w) {
          const newW = (drag as any)._w, newH = (drag as any)._h;
          const nx = (drag as any)._x, ny = (drag as any)._y;
          const patch: Partial<Item> = { x: nx, y: ny, width: newW, height: newH } as Partial<Item>;
          if (it.type === 'token') {
            // keep sizeCells consistent with new pixel size relative to grid
            const cellPx = it.width / it.sizeCells;
            (patch as Partial<import('../types').TokenItem>).sizeCells = Math.max(0.25, newW / cellPx);
          }
          // reset container scale (renderer will rebuild at new size)
          const c = getItemContainer(layer, it.id);
          if (c) c.scale.set(1, 1);
          useItemStore.getState().updateItem(it.id, patch);
          emitItemUpdate([{ id: it.id, patch }]);
        }
      } else if (registry.mode === 'group' && drag.origins) {
        const s = (drag as any)._scale ?? 1;
        const aX = drag.groupAnchorX!, aY = drag.groupAnchorY!;
        const patches: Array<{ id: string; patch: Partial<Item> }> = [];
        for (const [id, o] of drag.origins) {
          const nx = aX + (o.x - aX) * s;
          const ny = aY + (o.y - aY) * s;
          patches.push({ id, patch: { x: nx, y: ny, width: o.w * s, height: o.h * s } as Partial<Item> });
          const c = getItemContainer(layer, id);
          if (c) c.scale.set(1, 1);
        }
        useItemStore.getState().updateItems(patches);
        emitItemUpdate(patches);
      }
      drag = null;
    }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);

    return () => {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
    };
  }, [appReady, selectedIds, items, activeTool, myRole]);
}
