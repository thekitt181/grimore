import type { LiveTransform } from '../store/liveTransformStore';
import type { Item } from '../types';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';

export type GizmoHandleId = 'nw' | 'ne' | 'se' | 'sw' | 'n' | 'e' | 's' | 'w' | 'rotate';

export interface GizmoHandle {
  id: GizmoHandleId;
  wx: number;
  wy: number;
  sx: number;
  sy: number;
}

export interface TokenGizmoLayout {
  mode: 'none' | 'single' | 'group';
  itemId?: string;
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
  handles: GizmoHandle[];
  boxCorners: Array<{ x: number; y: number }>;
}

function rot(x: number, y: number, deg: number): { x: number; y: number } {
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

const ROT_DIST = 28;

/** Handle + box layout in world (Pixi x/y) space — shared by Pixi + Three.js gizmos. */
export function computeTokenGizmoLayout(
  items: Item[],
  liveById: Record<string, LiveTransform>,
  opts?: { moveOnly?: boolean },
): TokenGizmoLayout {
  if (items.length === 0) {
    return { mode: 'none', cx: 0, cy: 0, width: 0, height: 0, rotation: 0, handles: [], boxCorners: [] };
  }

  if (items.length === 1) {
    const it = items[0]!;
    const live = liveById[it.id];
    const { cx, cz, width: w, height: h, rotation } = resolveItemBounds(it, live);
    const cy = cz;
    const hw = w / 2;
    const hh = h / 2;
    const toWorld = (lx: number, ly: number) => {
      const r = rot(lx, ly, rotation);
      return { x: cx + r.x, y: cy + r.y };
    };
    const boxCorners = [
      toWorld(-hw, -hh),
      toWorld(hw, -hh),
      toWorld(hw, hh),
      toWorld(-hw, hh),
    ];
    const minDim = Math.min(w, h);
    const compact = minDim < 96;
    const handleOutset = compact ? Math.max(12, minDim * 0.16) : Math.max(8, minDim * 0.08);
    const defs: Array<[GizmoHandleId, number, number]> = [
      ['nw', -1, -1], ['ne', 1, -1], ['se', 1, 1], ['sw', -1, 1],
    ];
    const handles: GizmoHandle[] = defs.map(([id, sx, sy]) => {
      const pt = toWorld(sx * (hw + handleOutset), sy * (hh + handleOutset));
      return { id, wx: pt.x, wy: pt.y, sx, sy };
    });
    const rotDist = compact ? Math.max(ROT_DIST, minDim * 0.55) : ROT_DIST;
    const rotPt = toWorld(0, -hh - rotDist);
    handles.push({ id: 'rotate', wx: rotPt.x, wy: rotPt.y, sx: 0, sy: 0 });
    return {
      mode: 'single',
      itemId: it.id,
      cx,
      cy,
      width: w,
      height: h,
      rotation,
      handles: opts?.moveOnly ? [] : handles,
      boxCorners,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of items) {
    const live = liveById[it.id];
    const b = resolveItemBounds(it, live);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  const cx = minX + w / 2;
  const cy = minY + h / 2;
  const handles: GizmoHandle[] = [
    { id: 'nw', wx: minX, wy: minY, sx: -1, sy: -1 },
    { id: 'ne', wx: maxX, wy: minY, sx: 1, sy: -1 },
    { id: 'se', wx: maxX, wy: maxY, sx: 1, sy: 1 },
    { id: 'sw', wx: minX, wy: maxY, sx: -1, sy: 1 },
  ];
  return {
    mode: 'group',
    cx,
    cy,
    width: w,
    height: h,
    rotation: 0,
    handles: opts?.moveOnly ? [] : handles,
    boxCorners: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ],
  };
}
