import { useEffect, useRef } from 'react';
import { Container } from 'pixi.js';
import { useMapStore } from '../store/mapStore';
import { useItemStore, getActiveMap } from '@/systems/scene/store/itemStore';
import {
  useLiveTransformStore,
  itemsWithLiveTransforms,
} from '@/systems/scene/store/liveTransformStore';
import { useSessionStore } from '@/store/sessionStore';
import { clearFogLayers, drawFogLayers, ensureFogLayers } from '../fogRender';
import { fogDisplayZIndex } from '@/systems/scene/zOrder';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import type { MapItem } from '@/systems/scene/types';

function syncMapFogOverlays(
  layer: Container,
  fogContainers: Map<string, Container>,
  opts: {
    items: ReturnType<typeof useItemStore.getState>['items'];
    liveById: ReturnType<typeof useLiveTransformStore.getState>['byId'];
    revealedCells: Set<string>;
    isGM: boolean;
    selectedIds: string[];
    myUserId: string | null;
    showFogOverlay: boolean;
  },
): void {
  const activeMap = getActiveMap();
  const itemsForFog = itemsWithLiveTransforms(opts.items, opts.liveById);
  const liveMapIds = new Set(
    Object.values(opts.items)
      .filter((i): i is MapItem => i.type === 'map')
      .map((m) => m.id),
  );

  for (const [mapId, fc] of fogContainers) {
    if (!liveMapIds.has(mapId)) {
      fc.destroy({ children: true });
      fogContainers.delete(mapId);
    }
  }

  for (const item of Object.values(opts.items)) {
    if (item.type !== 'map') continue;
    const map = item as MapItem;

    let fc = fogContainers.get(map.id);
    if (!fc || fc.parent !== layer) {
      fc = new Container();
      fc.label = `fog_${map.id}`;
      fc.eventMode = 'none';
      layer.addChild(fc);
      fogContainers.set(map.id, fc);
    }

    const fogLayers = ensureFogLayers(fc);

    fc.scale.set(1, 1);
    fc.pivot.set(map.width / 2, map.height / 2);
    fc.position.set(map.x + map.width / 2, map.y + map.height / 2);
    fc.rotation = (map.rotation * Math.PI) / 180;
    fc.zIndex = fogDisplayZIndex(map.zIndex);

    const isActive = activeMap?.id === map.id;
    const showThis = isActive && opts.showFogOverlay;

    if (map.visible) {
      fc.visible = showThis;
      fc.alpha = 1;
    } else if (opts.isGM) {
      fc.visible = showThis;
      fc.alpha = 0.35;
    } else {
      fc.visible = false;
    }

    if (isActive) {
      drawFogLayers(fogLayers, map, {
        revealedCells: opts.revealedCells,
        gridSize: map.gridSize,
        isGM: opts.isGM,
        items: itemsForFog,
        selectedIds: opts.selectedIds,
        myUserId: opts.myUserId,
        visible: showThis,
      }, sceneRefs.app.current?.renderer ?? null);
    } else {
      clearFogLayers(fogLayers);
    }
  }
}

/**
 * Renders fog on a map-attached overlay in the items layer (same transform as walls).
 * Survives Pixi re-inits because it rebinds whenever appReady or items change.
 */
export function useMapFogOverlay(
  layerRef: React.RefObject<Container | null>,
  appReady: boolean,
) {
  const revealedCells = useMapStore((s) => s.revealedCells);
  const revealedCount = useMapStore((s) => s.revealedCells.size);
  const fogEnabled = useMapStore((s) => s.fogEnabled);
  const sessionFogActive = useMapStore((s) => s.sessionFogActive);
  const items = useItemStore((s) => s.items);
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const { myRole, myUserId } = useSessionStore();

  const isGM = myRole === 'GM';
  const showFogOverlay = fogEnabled || sessionFogActive;

  const fogContainers = useRef<Map<string, Container>>(new Map());
  const fogStateRef = useRef({
    items,
    liveById,
    revealedCells,
    isGM,
    selectedIds,
    myUserId,
    showFogOverlay,
  });

  fogStateRef.current = {
    items,
    liveById,
    revealedCells,
    isGM,
    selectedIds,
    myUserId,
    showFogOverlay,
  };

  useEffect(() => {
    if (!appReady) {
      for (const c of fogContainers.current.values()) c.destroy({ children: true });
      fogContainers.current.clear();
      return;
    }

    const layer = layerRef.current;
    if (!layer) return;

    syncMapFogOverlays(layer, fogContainers.current, fogStateRef.current);
  }, [
    appReady,
    items,
    liveById,
    liveTick,
    revealedCells,
    revealedCount,
    fogEnabled,
    sessionFogActive,
    showFogOverlay,
    myRole,
    isGM,
    selectedIds,
    myUserId,
    layerRef,
  ]);

  useEffect(() => {
    if (!appReady || !showFogOverlay) return;
    const app = sceneRefs.app.current;
    const layer = layerRef.current;
    if (!app || !layer) return;

    const onTick = () => {
      const state = fogStateRef.current;
      if (!state.showFogOverlay) return;
      const live = useLiveTransformStore.getState();
      if (Object.keys(live.byId).length === 0) return;
      syncMapFogOverlays(layer, fogContainers.current, {
        ...state,
        liveById: live.byId,
      });
    };

    app.ticker.add(onTick);
    return () => {
      app.ticker.remove(onTick);
    };
  }, [appReady, showFogOverlay, layerRef]);

  useEffect(() => {
    return () => {
      for (const c of fogContainers.current.values()) c.destroy({ children: true });
      fogContainers.current.clear();
    };
  }, []);
}
