import { useMemo } from 'react';
import { useMapStore } from '@/systems/map/store/mapStore';

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
    return {
      left: x + mapX * scale,
      top: y + mapY * scale,
      width: mapWidth * scale,
      height: mapHeight * scale,
      visible: true,
    };
  }, [mapX, mapY, mapWidth, mapHeight, viewport]);
}
