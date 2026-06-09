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
  const items = useItemStore((s) => s.items);
  const liveById = useLiveTransformStore((s) => s.byId);
  const liveTick = useLiveTransformStore((s) => s.tick);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const { myRole, myUserId } = useSessionStore();

  const fogContainers = useRef<Map<string, Container>>(new Map());

  const isGM = myRole === 'GM';
  const showFogOverlay = isGM ? fogEnabled : true;

  useEffect(() => {
    if (!appReady) {
      for (const c of fogContainers.current.values()) c.destroy({ children: true });
      fogContainers.current.clear();
      return;
    }

    const layer = layerRef.current;
    if (!layer) return;

    const activeMap = getActiveMap();
    const itemsForFog = itemsWithLiveTransforms(items, liveById);
    const liveMapIds = new Set(
      Object.values(items)
        .filter((i): i is MapItem => i.type === 'map')
        .map((m) => m.id),
    );

    for (const [mapId, fc] of fogContainers.current) {
      if (!liveMapIds.has(mapId)) {
        fc.destroy({ children: true });
        fogContainers.current.delete(mapId);
      }
    }

    for (const item of Object.values(items)) {
      if (item.type !== 'map') continue;
      const map = item as MapItem;

      let fc = fogContainers.current.get(map.id);
      if (!fc || fc.parent !== layer) {
        fc = new Container();
        fc.label = `fog_${map.id}`;
        fc.eventMode = 'none';
        layer.addChild(fc);
        fogContainers.current.set(map.id, fc);
      }

      const fogLayers = ensureFogLayers(fc);

      fc.scale.set(1, 1);
      fc.pivot.set(map.width / 2, map.height / 2);
      fc.position.set(map.x + map.width / 2, map.y + map.height / 2);
      fc.rotation = (map.rotation * Math.PI) / 180;
      fc.zIndex = fogDisplayZIndex(map.zIndex);

      const isActive = activeMap?.id === map.id;
      const showThis = isActive && showFogOverlay;

      if (map.visible) {
        fc.visible = showThis;
        fc.alpha = 1;
      } else if (isGM) {
        fc.visible = showThis;
        fc.alpha = 0.35;
      } else {
        fc.visible = false;
      }

      if (isActive) {
        const renderer = sceneRefs.app.current?.renderer;
        if (renderer) {
          drawFogLayers(fogLayers, map, {
            revealedCells,
            gridSize: map.gridSize,
            isGM,
            items: itemsForFog,
            selectedIds,
            myUserId,
            visible: showThis,
          }, renderer);
        }
      } else {
        clearFogLayers(fogLayers);
      }
    }
  }, [
    appReady,
    items,
    liveById,
    liveTick,
    revealedCells,
    revealedCount,
    fogEnabled,
    showFogOverlay,
    myRole,
    isGM,
    selectedIds,
    myUserId,
    layerRef,
  ]);

  useEffect(() => {
    return () => {
      for (const c of fogContainers.current.values()) c.destroy({ children: true });
      fogContainers.current.clear();
    };
  }, []);
}
