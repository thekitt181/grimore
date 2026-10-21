import { useRef } from 'react';
import type { Group } from 'three';
import type { MapItem } from '@/systems/scene/types';
import { SceneModel } from './SceneModel';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { MapPickVolume } from './MapPickVolume';
import { TokenSelectionGizmo } from './Map3DTokenGizmo';
import { MAP_MODEL_YAW } from './mapModelYaw';

export function Map3DMapModel({
  map,
  showGizmo = false,
  /** Preview underlay — no pick volumes / pose registration. */
  displayOnly = false,
}: {
  map: MapItem;
  showGizmo?: boolean;
  displayOnly?: boolean;
}) {
  const modelRootRef = useRef<Group>(null);

  if (!map.modelUrl) return null;
  const targetSize = Math.max(map.width, map.height);

  return (
    <SceneItemTransformGroup
      itemId={map.id}
      surfaceY={0}
      baseWidth={map.width}
      baseHeight={map.height}
      displayOnly={displayOnly}
    >
      {/* Same yaw in 2D, 3D, and the side editor — keeps mesh locked to the grid. */}
      <group ref={modelRootRef} rotation={[0, MAP_MODEL_YAW, 0]}>
        <SceneModel
          key={`${map.id}:${map.modelUrl}`}
          url={map.modelUrl}
          targetSize={targetSize}
          footprint={{ width: map.width, height: map.height }}
          groundAlign
          registerRaycast={!displayOnly}
          {...(!displayOnly ? { collisionMap: map } : {})}
        />
      </group>
      {!displayOnly && <MapPickVolume map={map} modelRootRef={modelRootRef} />}
      {showGizmo && !displayOnly && (
        <TokenSelectionGizmo
          itemId={map.id}
          meshBaseWidth={map.width}
          meshBaseHeight={map.height}
          modelRootRef={modelRootRef}
          fitToModelBounds
        />
      )}
    </SceneItemTransformGroup>
  );
}
