import { useRef } from 'react';
import type { Group } from 'three';
import type { MapItem } from '@/systems/scene/types';
import { SceneModel } from './SceneModel';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { MapPickVolume } from './MapPickVolume';
import { TokenSelectionGizmo } from './Map3DTokenGizmo';
import { MAP_MODEL_YAW } from './mapModelYaw';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import {
  isModularGate,
  isModularMap,
  modularDepthStretch,
  modularScaleOf,
  modularWidthStretch,
  MODULAR_PX_PER_UNIT,
  pieceForUrl,
} from '@/systems/map/library/modularMapSnap';

export function Map3DMapModel({
  map,
  showGizmo = false,
  displayOnly = false,
}: {
  map: MapItem;
  showGizmo?: boolean;
  displayOnly?: boolean;
}) {
  const modelRootRef = useRef<Group>(null);
  const live = useLiveTransformStore((s) => s.byId[map.id]);
  const width = live?.width ?? map.width;
  const height = live?.height ?? map.height;
  const targetSize = Math.max(width, height);
  const modelUrl = map.modelUrl ?? null;
  if (!modelUrl) return null;

  const modular = isModularMap(map);
  const gate = isModularGate(map);
  const piece = pieceForUrl(modelUrl);
  const meterScale = modular ? modularScaleOf({ ...map, width, height }) : 1;
  const fixedWorldScale = modular ? meterScale * MODULAR_PX_PER_UNIT : undefined;
  const doorNode = piece?.anim?.doorNode;

  return (
    <SceneItemTransformGroup
      itemId={map.id}
      surfaceY={0}
      baseWidth={width}
      baseHeight={height}
      displayOnly={displayOnly}
    >
      <group ref={modelRootRef} rotation={[0, MAP_MODEL_YAW, 0]}>
        <SceneModel
          key={`${map.id}:${map.modelUrl}`}
          url={modelUrl}
          targetSize={targetSize}
          footprint={{ width, height }}
          groundAlign
          registerRaycast={!displayOnly}
          {...(fixedWorldScale != null ? { fixedWorldScale } : {})}
          {...(piece ? { depthStretch: modularDepthStretch(piece), widthStretch: modularWidthStretch(piece) } : {})}
          {...(!displayOnly ? { collisionMap: map } : {})}
          {...(gate ? { modularOpen: Boolean(map.modularOpen) } : {})}
          {...(gate && map.modularOpenAt != null ? { modularOpenAt: map.modularOpenAt } : {})}
          {...(gate ? { doorNode: doorNode ?? 'door' } : {})}
        />
      </group>
      {!displayOnly && <MapPickVolume map={map} modelRootRef={modelRootRef} />}
      {showGizmo && !displayOnly && (
        <TokenSelectionGizmo
          itemId={map.id}
          meshBaseWidth={width}
          meshBaseHeight={height}
          modelRootRef={modelRootRef}
          fitToModelBounds
        />
      )}
    </SceneItemTransformGroup>
  );
}
