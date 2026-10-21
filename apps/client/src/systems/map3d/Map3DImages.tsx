import { Suspense, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { isSceneItemOnTable } from '@/systems/scene/sceneMapsForClient';
import type { ImageItem } from '@/systems/scene/types';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import { isDoorPropId } from '@/systems/map/props/doorCollision';
import { useThreeTexture } from './useThreeTexture';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { TokenNameLabel } from './TokenNameLabel';
import { TokenPickVolume } from './TokenPickVolume';
import { PropMesh3D, hasPropMesh3D } from './propMeshes3d';
import { PropModel3D, hasPropModel3D, PropModelsPreload, propModelLight } from './PropModel3D';
import { PropAnim3D, useLivePropAmount } from './propAnim3d';

const _world = new THREE.Vector3();

/** Yaw-only billboard for generic (non-catalog) map images. */
function YawBillboard({ children }: { children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    g.getWorldPosition(_world);
    const dx = camera.position.x - _world.x;
    const dz = camera.position.z - _world.z;
    if (dx * dx + dz * dz < 1e-6) return;
    const parentYaw = g.parent ? g.parent.rotation.y : 0;
    g.rotation.y = Math.atan2(dx, dz) - parentYaw;
  });

  return <group ref={ref}>{children}</group>;
}

function GenericImageBillboard({
  item,
  displayOnly = false,
}: {
  item: ImageItem;
  displayOnly?: boolean;
}) {
  const { texture } = useThreeTexture(item.imageUrl);
  const footprint = Math.min(item.width, item.height);
  const img = texture?.image as { width?: number; height?: number } | undefined;
  const aspect =
    img && typeof img.width === 'number' && typeof img.height === 'number' && img.height > 0
      ? img.width / img.height
      : 1;
  const planeW = footprint;
  const planeH = Math.max(footprint * 0.85, footprint / Math.max(aspect, 0.35));
  const opacity = item.visible === false ? 0.35 : 1;

  return (
    <>
      <YawBillboard>
        <mesh position={[0, planeH / 2, 0]} renderOrder={14}>
          <planeGeometry args={[planeW, planeH]} />
          <meshStandardMaterial
            {...(texture ? { map: texture } : {})}
            color={texture ? '#ffffff' : '#1c1c28'}
            transparent
            opacity={opacity}
            roughness={0.62}
            side={THREE.DoubleSide}
            alphaTest={0.08}
            depthWrite={opacity >= 0.99}
          />
        </mesh>
      </YawBillboard>
      {!displayOnly && (
        <TokenPickVolume itemId={item.id} radius={footprint * 0.52} height={planeH} y={0} />
      )}
    </>
  );
}

function GlbProp({ item, propId, footprint }: { item: ImageItem; propId: string; footprint: number }) {
  const open = (item.propState ?? 0) > 0;
  const light = propModelLight(propId);
  return (
    <PropAnim3D
      item={item}
      size={footprint}
      {...(light ? { light } : {})}
      driveGroup
    >
      <PropModel3D propId={propId} open={open} size={footprint} />
    </PropAnim3D>
  );
}

function MeshProp({
  item,
  propId,
  footprint,
  wallHeight,
}: {
  item: ImageItem;
  propId: string;
  footprint: number;
  wallHeight?: number;
}) {
  const amount = useLivePropAmount(item);
  return (
    <PropAnim3D item={item} size={footprint} driveGroup={false}>
      <PropMesh3D
        propId={propId}
        amount={amount}
        size={footprint}
        {...(wallHeight != null ? { height: wallHeight } : {})}
      />
    </PropAnim3D>
  );
}

function MapImageMesh({ item, displayOnly = false }: { item: ImageItem; displayOnly?: boolean }) {
  const propId = resolvePropId(item);
  const wallHeightCells = useMapStore((s) => s.wallHeightCells);
  const gridSize = useItemStore((s) => {
    void s.items;
    void s.activeMapId;
    return getActiveMap()?.gridSize ?? 96;
  });
  const isDoor = isDoorPropId(propId);
  // Doors/gates are wide+thin after wall-fit — scale 3D from the opening span, not the hairline depth.
  const footprint = isDoor
    ? Math.max(item.width, item.height)
    : Math.min(item.width, item.height);
  const wallHeight = isDoor ? gridSize * wallHeightCells : undefined;
  const useGlb = hasPropModel3D(propId);
  const useMesh = !useGlb && hasPropMesh3D(propId);

  const meshBase = useRef({ w: item.width, h: item.height });
  if (meshBase.current.w !== item.width || meshBase.current.h !== item.height) {
    meshBase.current = { w: item.width, h: item.height };
  }

  const pickH = wallHeight
    ?? (useGlb ? Math.max(footprint * 1.45, 32) : Math.max(footprint * 1.15, 28));

  return (
    <SceneItemTransformGroup
      itemId={item.id}
      surfaceY="ground"
      baseWidth={meshBase.current.w}
      baseHeight={meshBase.current.h}
      displayOnly={displayOnly}
    >
      {propId && useGlb ? (
        <>
          {/* Nested Suspense so one slow prop GLB cannot blank the whole 3D scene. */}
          <Suspense fallback={null}>
            <GlbProp item={item} propId={propId} footprint={footprint} />
          </Suspense>
          {!displayOnly && (
            <TokenPickVolume
              itemId={item.id}
              radius={Math.max(item.width, item.height) * 0.52}
              height={pickH}
              y={0}
            />
          )}
        </>
      ) : propId && useMesh ? (
        <>
          <MeshProp
            item={item}
            propId={propId}
            footprint={footprint}
            {...(wallHeight != null ? { wallHeight } : {})}
          />
          {!displayOnly && (
            <TokenPickVolume
              itemId={item.id}
              radius={Math.max(item.width, item.height) * 0.52}
              height={pickH}
              y={0}
            />
          )}
        </>
      ) : (
        <GenericImageBillboard item={item} displayOnly={displayOnly} />
      )}
      <TokenNameLabel name={item.name} footprint={footprint} />
    </SceneItemTransformGroup>
  );
}

export function Map3DImages({
  images,
  displayOnly = false,
}: {
  images: ImageItem[];
  displayOnly?: boolean;
}) {
  if (images.length === 0) return null;
  return (
    <group>
      {images.map((item) => (
        <MapImageMesh key={item.id} item={item} displayOnly={displayOnly} />
      ))}
    </group>
  );
}

/** Scene images visible on the table (props + placed art). */
export function useSceneTableImages(): ImageItem[] {
  const items = useItemStore((s) => s.items);
  const gm = useSessionStore((s) => s.myRole === 'GM');
  return Object.values(items).filter(
    (i): i is ImageItem => i.type === 'image' && isSceneItemOnTable(i, gm),
  );
}

/** Live dungeon props as textured GLBs (KayKit) + procedural fallbacks, with 2D-matched motion. */
export function Map3DImageLayer() {
  const viewMode = useMapStore((s) => s.viewMode);
  const images = useSceneTableImages();
  // Keep loading props in 3D even while the GM 2D side editor is open.
  if (viewMode !== '3d') return null;
  return (
    <>
      <PropModelsPreload />
      <Suspense fallback={null}>
        <Map3DImages images={images} />
      </Suspense>
    </>
  );
}
