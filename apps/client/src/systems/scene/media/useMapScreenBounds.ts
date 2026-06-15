import { useMemo } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';
import { getMapPointerRect } from '@/systems/map3d/pixiScreenCoords';
import { pixiScreenSize } from '@/systems/map3d/pixiCanvasMetrics';

export interface MapScreenRect {
  left: number;
  top: number;
  width: number;
  height: number;
  visible: boolean;
}

/** Screen-space bounds of the active map image inside the map canvas. */
export function useMapScreenBounds(): MapScreenRect {
  const mapX = useMapStore((s) => s.mapX);
  const mapY = useMapStore((s) => s.mapY);
  const mapWidth = useMapStore((s) => s.mapWidth);
  const mapHeight = useMapStore((s) => s.mapHeight);
  const viewport = useMapStore((s) => s.viewport);

  return useMemo(() => {
    if (mapWidth <= 0 || mapHeight <= 0) {
      return { left: 0, top: 0, width: 0, height: 0, visible: false };
    }
    const { x, y, scale } = viewport;
    const resLeft = x + mapX * scale;
    const resTop = y + mapY * scale;
    const resWidth = mapWidth * scale;
    const resHeight = mapHeight * scale;

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
  }, [mapX, mapY, mapWidth, mapHeight, viewport]);
}
