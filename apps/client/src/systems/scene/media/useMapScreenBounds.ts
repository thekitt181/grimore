import { useMemo } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { getMapPointerRect } from '@/systems/map3d/pixiScreenCoords';
import { pixiScreenSize } from '@/systems/map3d/pixiCanvasMetrics';
import { resolveAtmosphereTargetMap } from './resolveAtmosphereTargetMap';
import type { MapItem } from '@/systems/scene/types';

export interface MapScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

function boundsForMap(map: MapItem, viewport: { x: number; y: number; scale: number }): MapScreenRect {
  const { x, y, scale } = viewport;
  const resLeft = x + map.x * scale;
  const resTop = y + map.y * scale;
  const resWidth = map.width * scale;
  const resHeight = map.height * scale;

  const pixi = pixiScreenSize();
  const canvas = getMapPointerRect();
  if (!pixi || !canvas || pixi.w <= 0 || pixi.h <= 0) {
    return {
      left: resLeft,
      top: resTop,
      width: resWidth,
      height: resHeight,
      visible: true,
    };
  }

  const cssScaleX = canvas.width / pixi.w;
  const cssScaleY = canvas.height / pixi.h;
  return {
    left: resLeft * cssScaleX,
    top: resTop * cssScaleY,
    width: resWidth * cssScaleX,
    height: resHeight * cssScaleY,
    visible: true,
  };
}

/** Screen-space bounds of the target map (selected map, else active map). */
export function useMapScreenBounds(): MapScreenRect {
  const items = useItemStore((s) => s.items);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const viewport = useMapStore((s) => s.viewport);

  return useMemo(() => {
    void items;
    void selectedIds;
    void activeMapId;
    const map = resolveAtmosphereTargetMap();
    if (!map || map.width <= 0 || map.height <= 0) {
      return { left: 0, top: 0, width: 0, height: 0, visible: false };
    }
    return boundsForMap(map, viewport);
  }, [items, selectedIds, activeMapId, viewport]);
}
