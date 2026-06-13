import type { MapItem } from '@/systems/scene/types';
import { SceneModel } from './SceneModel';
import { SceneItemTransformGroup } from './TokenTransformGroup';

export function Map3DMapModel({ map }: { map: MapItem }) {
  if (!map.modelUrl) return null;
  const targetSize = Math.max(map.width, map.height);

  return (
    <SceneItemTransformGroup itemId={map.id} surfaceY={0} baseWidth={map.width} baseHeight={map.height}>
      <SceneModel url={map.modelUrl} targetSize={targetSize} groundAlign registerRaycast />
    </SceneItemTransformGroup>
  );
}
