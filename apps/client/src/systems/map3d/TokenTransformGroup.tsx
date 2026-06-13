import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group } from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { degToRad } from './coords';
import { groundHeightAt } from './mapGroundRaycast';
import { resolveItemBounds } from './sceneItemBounds';
import type { Item } from '@/systems/scene/types';

const TOKEN_SURFACE_PAD = 0.12;

/** Per-frame world transform — same bounds source as the Pixi selection gizmo. */
export function SceneItemTransformGroup({
  itemId,
  surfaceY = 0,
  baseWidth,
  baseHeight,
  scaleBaseWidth,
  scaleBaseHeight,
  children,
}: {
  itemId: string;
  surfaceY?: number | 'ground';
  /** Live scale divisor for maps (updates when store size changes). */
  baseWidth?: number;
  baseHeight?: number;
  /** Frozen mesh base for tokens — scale = liveBounds / meshBase (stable across resize commit). */
  scaleBaseWidth?: number;
  scaleBaseHeight?: number;
  children: React.ReactNode;
}) {
  const ref = useRef<Group>(null);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;

    const item = useItemStore.getState().items[itemId];
    if (!item) return;

    const live = useLiveTransformStore.getState().byId[itemId];
    const b = resolveItemBounds(item as Item, live);
    const y = surfaceY === 'ground'
      ? groundHeightAt(b.cx, b.cz, 0) + TOKEN_SURFACE_PAD
      : surfaceY;

    g.position.set(b.cx, y, b.cz);
    // Tabletop spin: Y axis only (Pixi CW → Three -Y).
    const spinY = item.type === 'token' ? -degToRad(b.rotation) : degToRad(b.rotation);
    g.rotation.set(0, spinY, 0);

    const sx = scaleBaseWidth ?? baseWidth;
    const sz = scaleBaseHeight ?? baseHeight;
    if (sx != null && sz != null && sx > 0 && sz > 0) {
      g.scale.set(b.width / sx, 1, b.height / sz);
    } else {
      g.scale.set(1, 1, 1);
    }
    g.updateMatrixWorld(true);
  });

  return <group ref={ref}>{children}</group>;
}

/** @deprecated use SceneItemTransformGroup */
export const TokenTransformGroup = SceneItemTransformGroup;
