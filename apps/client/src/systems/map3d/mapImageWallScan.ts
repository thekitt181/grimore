/** @deprecated Import from mapImageSceneScan instead */
import {
  scanMapImageForScene,
  sceneScanCacheKey,
  type MapSceneScanResult,
} from './mapImageSceneScan';

export type WallCellGrid = {
  cols: number;
  rows: number;
  cells: Uint8Array;
};

export type MapWallScanResult = WallCellGrid & { wallCellCount: number };

export async function scanMapImageForWalls(
  map: Parameters<typeof scanMapImageForScene>[0],
  options?: Parameters<typeof scanMapImageForScene>[1],
): Promise<MapWallScanResult | null> {
  const scene = await scanMapImageForScene(map, options);
  if (!scene) return null;
  return {
    cols: scene.cols,
    rows: scene.rows,
    cells: scene.wallCells,
    wallCellCount: scene.wallCellCount,
  };
}

export const wallScanCacheKey = sceneScanCacheKey;
export type { MapSceneScanResult };
