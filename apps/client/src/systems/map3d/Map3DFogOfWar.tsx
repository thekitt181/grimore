import { useCallback, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  itemsWithLiveTransforms,
  useLiveTransformStore,
} from '@/systems/scene/store/liveTransformStore';
import { useSessionStore } from '@/store/sessionStore';
import { paintFogCanvas } from '@/systems/map/fogRender';
import { fogTextureDimensions } from '@/systems/map/fogTextureSize';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import type { MapItem } from '@/systems/scene/types';
import { SceneItemTransformGroup } from './TokenTransformGroup';

const FOG_Y = 0.1;
/** Above map mesh (0) but below tokens (12+) so minis stay visible on lit squares. */
const FOG_RENDER_ORDER = 11;

function useFogDrawState(map: MapItem) {
  const revealedCells = useMapStore((s) => s.revealedCells);
  const revealedCount = useMapStore((s) => s.revealedCells.size);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const sessionFogActive = useMapStore((s) => s.sessionFogActive);
  const items = useItemStore((s) => s.items);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const myRole = useSessionStore((s) => s.myRole);
  const myUserId = useSessionStore((s) => s.myUserId);

  const isGM = myRole === 'GM';
  const showFogOverlay = fogEnabled || sessionFogActive;
  const activeMap = getActiveMap();
  const isActive = activeMap?.id === map.id;
  const visible = isActive && showFogOverlay && isFogOverlayVisible() && (map.visible || isGM);

  const itemsForFog = useMemo(
    () => itemsWithLiveTransforms(items, liveById),
    [items, liveById, liveTick],
  );

  return {
    visible,
    isGM,
    revealedCells,
    revealedCount,
    itemsForFog,
    selectedIds,
    myUserId,
    liveTick,
  };
}

/** Wall-aware fog-of-war on the 3D map ground (directional vision cones + GM reveal). */
export function Map3DFogOfWar({ map }: { map: MapItem }) {
  const state = useFogDrawState(map);

  const { canvas, texture, texScale } = useMemo(() => {
    const { width, height, scale } = fogTextureDimensions(map.width, map.height);
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const t = new THREE.CanvasTexture(c);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    return { canvas: c, texture: t, texScale: scale };
  }, [map.width, map.height]);

  const materialRef = useRef<THREE.MeshBasicMaterial | null>(null);

  const repaintFog = useCallback(() => {
    if (!state.visible) {
      if (materialRef.current) materialRef.current.visible = false;
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.setTransform(texScale, 0, 0, texScale, 0, 0);
    paintFogCanvas(ctx, map, {
      revealedCells: state.revealedCells,
      gridSize: map.gridSize,
      isGM: state.isGM,
      items: state.itemsForFog,
      selectedIds: state.selectedIds,
      myUserId: state.myUserId,
      visible: true,
    });

    texture.needsUpdate = true;
    if (materialRef.current) {
      materialRef.current.visible = true;
      materialRef.current.opacity = state.isGM ? (map.visible ? 0.5 : 0.35) : 1;
    }
  }, [
    canvas,
    map,
    state.visible,
    state.isGM,
    state.revealedCells,
    state.itemsForFog,
    state.selectedIds,
    state.myUserId,
    texScale,
    texture,
  ]);

  useEffect(() => () => {
    texture.dispose();
  }, [texture]);

  useEffect(() => {
    repaintFog();
  }, [repaintFog, state.liveTick, state.revealedCount]);

  useEffect(() => {
    if (!state.visible && materialRef.current) {
      materialRef.current.visible = false;
    }
  }, [state.visible]);

  if (!state.visible) return null;

  return (
    <SceneItemTransformGroup itemId={map.id} surfaceY={FOG_Y}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={FOG_RENDER_ORDER}>
        <planeGeometry args={[map.width, map.height]} />
        <meshBasicMaterial
          ref={materialRef}
          map={texture}
          transparent
          opacity={state.isGM ? (map.visible ? 0.5 : 0.35) : 1}
          depthTest={false}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </SceneItemTransformGroup>
  );
}
