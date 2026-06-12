import type { MapItem } from '@/systems/scene/types';
import { degToRad } from './coords';
import { SceneModel } from './SceneModel';
import { useLiveItemBounds } from './useLiveItemBounds';

export function Map3DMapModel({ map }: { map: MapItem }) {
  if (!map.modelUrl) return null;
  const { cx, cz, rotation } = useLiveItemBounds(map);
  const targetSize = Math.max(map.width, map.height);

  return (
    <group position={[cx, 0, cz]} rotation={[0, degToRad(rotation), 0]}>
      <SceneModel url={map.modelUrl} targetSize={targetSize} groundAlign registerRaycast />
    </group>
  );
}
