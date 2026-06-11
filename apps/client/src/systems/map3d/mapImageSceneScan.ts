import {
  scanMapImageFromPixelData,
  type MapSceneScanOptions,
  type MapSceneScanResult,
  type MapScanInput,
} from '@grimoire/shared';

export {
  buildSceneFromWalkableGrid,
  extractWallSegments,
  extractWallSegmentsFromWalkable,
  scanMapImageFromPixelData,
  sceneScanCacheKey,
  type MapScanInput,
  type MapSceneScanOptions,
  type MapSceneScanResult,
  type ScannedDoor,
  type ScannedPit,
  type ScannedProp,
  type ScannedStairs,
  type ScannedWallSegment,
  type ScannedWater,
} from '@grimoire/shared';

function readImagePixels(img: HTMLImageElement, width: number, height: number): Uint8ClampedArray | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, width, height);
  try {
    return ctx.getImageData(0, 0, width, height).data;
  } catch {
    return null;
  }
}

export async function scanMapImageForScene(
  map: MapScanInput & { id?: string; backgroundUrl: string | null },
  options?: MapSceneScanOptions,
): Promise<MapSceneScanResult | null> {
  if (!map.backgroundUrl) return null;

  const maxDim = 2800;
  const scale = Math.min(1, maxDim / Math.max(map.width, map.height));
  const sampleW = Math.max(32, Math.round(map.width * scale));
  const sampleH = Math.max(32, Math.round(map.height * scale));

  const { loadImageUrl } = await import('@/lib/textureLoader');
  const img = await loadImageUrl(map.backgroundUrl);
  const data = readImagePixels(img, sampleW, sampleH);
  if (!data) return null;

  return scanMapImageFromPixelData(map, data, sampleW, sampleH, options);
}
