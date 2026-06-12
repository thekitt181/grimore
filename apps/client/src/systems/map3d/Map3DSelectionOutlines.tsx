import { useMemo } from 'react';
import { Line } from '@react-three/drei';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { degToRad } from './coords';
import type { Item } from '@/systems/scene/types';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';

const GOLD = 0xc9a84c;

function rot2d(lx: number, ly: number, deg: number) {
  const r = degToRad(deg);
  return {
    x: lx * Math.cos(r) - ly * Math.sin(r),
    y: lx * Math.sin(r) + ly * Math.cos(r),
  };
}

function itemDrawBounds(item: Item, liveById: Record<string, { x?: number; y?: number; rotation?: number }>) {
  const live = liveById[item.id];
  const x = live?.x ?? item.x;
  const y = live?.y ?? item.y;
  const rotation = live?.rotation ?? item.rotation ?? 0;
  const cx = x + item.width / 2;
  const cy = y + item.height / 2;
  return { cx, cy, width: item.width, height: item.height, rotation };
}

function SelectionOutline({
  cx,
  cy,
  width,
  height,
  rotation,
}: {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}) {
  const points = useMemo(() => {
    const hw = width / 2;
    const hh = height / 2;
    const corners: [number, number][] = [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
      [-hw, -hh],
    ];
    const pts: [number, number, number][] = [];
    for (const [lx, ly] of corners) {
      const r = rot2d(lx, ly, rotation);
      pts.push([cx + r.x, 0.08, cy + r.y]);
    }
    return pts;
  }, [cx, cy, width, height, rotation]);

  return (
    <Line
      points={points}
      color={GOLD}
      lineWidth={1}
      transparent
      opacity={0.95}
      depthTest={false}
    />
  );
}

function manipulableSelectedItems(
  items: Record<string, Item>,
  selectedIds: string[],
  gm: boolean,
): Item[] {
  return selectedIds
    .map((id) => items[id])
    .filter((it): it is Item => {
      if (!it || it.locked) return false;
      if (gm) return true;
      return it.type === 'token';
    });
}

/** Ground-plane selection outlines synced to the 3D camera (replaces Pixi transform box in 3D). */
export function Map3DSelectionOutlines() {
  const selectedIds = useItemStore((s) => s.selectedIds);
  const items = useItemStore((s) => s.items);
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const activeTool = useMapStore((s) => s.activeTool);
  const myRole = useSessionStore((s) => s.myRole);
  const gm = myRole === 'GM';

  void liveTick;

  if (activeTool !== 'select') return null;

  const selected = manipulableSelectedItems(items, selectedIds, gm);
  if (selected.length === 0) return null;

  if (selected.length === 1) {
    const it = selected[0]!;
    const b = itemDrawBounds(it, liveById);
    return (
      <SelectionOutline
        cx={b.cx}
        cy={b.cy}
        width={b.width}
        height={b.height}
        rotation={b.rotation}
      />
    );
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const it of selected) {
    const b = itemDrawBounds(it, liveById);
    minX = Math.min(minX, b.cx - b.width / 2);
    minY = Math.min(minY, b.cy - b.height / 2);
    maxX = Math.max(maxX, b.cx + b.width / 2);
    maxY = Math.max(maxY, b.cy + b.height / 2);
  }
  const w = maxX - minX;
  const h = maxY - minY;
  return (
    <SelectionOutline
      cx={minX + w / 2}
      cy={minY + h / 2}
      width={w}
      height={h}
      rotation={0}
    />
  );
}
