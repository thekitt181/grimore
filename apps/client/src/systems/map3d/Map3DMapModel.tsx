import type { MapItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import { SceneModel } from './SceneModel';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { TABLE_MINI_VIEW_AZIMUTH_OFFSET } from './orthographicCameraSync';

/** Match token import yaw so the map mesh sits inside the selection rect in 2D. */
const MAP_2D_IMPORT_YAW = Math.PI + TABLE_MINI_VIEW_AZIMUTH_OFFSET;

export function Map3DMapModel({ map }: { map: MapItem }) {
  if (!map.modelUrl) return null;
  const viewMode = useMapStore((s) => s.viewMode);
  const view2d = viewMode === '2d';
  const targetSize = Math.max(map.width, map.height);

  return (
    <SceneItemTransformGroup itemId={map.id} surfaceY={0} baseWidth={map.width} baseHeight={map.height}>
      <group rotation={[0, view2d ? MAP_2D_IMPORT_YAW : 0, 0]}>
        <SceneModel
          url={map.modelUrl}
          targetSize={targetSize}
          footprint={{ width: map.width, height: map.height }}
          groundAlign
          registerRaycast
        />
      </group>
    </SceneItemTransformGroup>
  );
}
