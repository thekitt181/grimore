import type { MapItem } from '@/systems/scene/types';
import { itemCenterXZ, degToRad } from './coords';
import { SceneModel } from './SceneModel';

export function Map3DMapModel({ map }: { map: MapItem }) {
  if (!map.modelUrl) return null;
  const [cx, cz] = itemCenterXZ(map);
  const targetSize = Math.max(map.width, map.height);

  return (
    <group position={[cx, 0, cz]} rotation={[0, degToRad(map.rotation), 0]}>
      <SceneModel url={map.modelUrl} targetSize={targetSize} groundAlign />
    </group>
  );
}
