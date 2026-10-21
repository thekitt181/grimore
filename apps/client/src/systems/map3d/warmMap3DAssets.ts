import { useMapStore } from '@/systems/map/store/mapStore';
import { resolveMapSurfaceStyle, type MapSurfaceStyleId } from './mapSurfaceStyles';
import { pbrAssetForStyle } from './pbrSurfaceAssets';
import { loadPbrSurfaceMaps } from './pbrSurfaceLoader';
import { getMapSurfaceTexture } from './mapSurfaceTextures';
import { preloadPropModels3D } from './PropModel3D';
import { allDoorPbrSlugs } from './doorPbrAssets';

let lastWall = '';
let lastFloor = '';
let warmJob: Promise<void> | null = null;

function warmStyle(styleId: MapSurfaceStyleId): void {
  const style = resolveMapSurfaceStyle(styleId);
  for (const kind of ['wall', 'floor'] as const) {
    const asset = pbrAssetForStyle(style.id, kind);
    if (asset) void loadPbrSurfaceMaps(asset);
    getMapSurfaceTexture(styleId, kind);
  }
}

/** Start loading props + wall/floor PBR before FP so entering walk mode does not remount the GL context. */
export function warmMap3DAssets(): Promise<void> {
  const wallStyleId = useMapStore.getState().wallStyleId as MapSurfaceStyleId;
  const floorStyleId = useMapStore.getState().floorStyleId as MapSurfaceStyleId;
  if (warmJob && lastWall === wallStyleId && lastFloor === floorStyleId) {
    return warmJob;
  }
  lastWall = wallStyleId;
  lastFloor = floorStyleId;
  warmJob = Promise.resolve().then(() => {
    preloadPropModels3D();
    warmStyle(wallStyleId);
    if (floorStyleId !== wallStyleId) warmStyle(floorStyleId);
    for (const slug of allDoorPbrSlugs()) {
      void loadPbrSurfaceMaps(slug);
    }
  });
  return warmJob;
}
