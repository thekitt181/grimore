import { Component, Suspense, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useSessionStore } from '@/store/sessionStore';
import { isSceneItemOnTable } from '@/systems/scene/sceneMapsForClient';
import type { ImageItem } from '@/systems/scene/types';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import { hasPropCanvasArt } from '@/systems/map/props/propCanvasArt';
import { isDoorPropId } from '@/systems/map/props/doorCollision';
import { usePropDisplayTexture } from './usePropDisplayTexture';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { TokenNameLabel } from './TokenNameLabel';
import { TokenPickVolume } from './TokenPickVolume';
import { PropMesh3D, hasPropMesh3D } from './propMeshes3d';
import { PropModel3D, hasPropModel3D, PropModelsPreload, propModelLight } from './PropModel3D';
import { PropAnim3D, useLivePropAmount } from './propAnim3d';
import { resolveDoorSurfaceStyle } from './doorSurfaceStyles';

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

class PropGlbErrorBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function PropArtBillboard({
  item,
  propId,
  displayOnly = false,
}: {
  item: ImageItem;
  propId: string;
  displayOnly?: boolean;
}) {
  const { texture, status } = usePropDisplayTexture(item, propId);
  const planeW = Math.max(item.width, 8);
  const planeH = Math.max(item.height, 8);
  const footprint = Math.max(planeW, planeH);
  const opacity = item.visible === false ? 0.35 : 1;

  if (!texture || status === 'error') {
    // Always try procedural mesh — canvas-art props have meshes too.
    return <MeshProp item={item} propId={propId} />;
  }

  const lockFacing =
    item.propMount === 'wall'
    || Math.abs(item.propPitch ?? 0) > 0.5
    || Math.abs(item.propRoll ?? 0) > 0.5;
  const plane = (
    <mesh position={[0, planeH / 2, 0]} renderOrder={14}>
      <planeGeometry args={[planeW, planeH]} />
      <meshStandardMaterial
        map={texture}
        color="#ffffff"
        transparent
        opacity={opacity}
        roughness={0.48}
        metalness={0.04}
        envMapIntensity={1.15}
        side={THREE.DoubleSide}
        alphaTest={0.08}
        depthWrite={opacity >= 0.99}
      />
    </mesh>
  );

  return (
    <>
      {lockFacing ? plane : <YawBillboard>{plane}</YawBillboard>}
      {!displayOnly && (
        <TokenPickVolume itemId={item.id} radius={footprint * 0.52} height={planeH} y={0} />
      )}
    </>
  );
}

function GenericImageBillboard({
  item,
  displayOnly = false,
}: {
  item: ImageItem;
  displayOnly?: boolean;
}) {
  const fallbackPropId = resolvePropId(item);
  const { texture, status } = usePropDisplayTexture(item, fallbackPropId);
  const planeW = Math.max(item.width, 8);
  const planeH = Math.max(item.height, 8);
  const footprint = Math.max(planeW, planeH);
  const opacity = item.visible === false ? 0.35 : 1;

  if (fallbackPropId && (hasPropMesh3D(fallbackPropId) || !texture || status === 'error')) {
    return <MeshProp item={item} propId={fallbackPropId} />;
  }

  const lockFacing =
    item.propMount === 'wall'
    || Math.abs(item.propPitch ?? 0) > 0.5
    || Math.abs(item.propRoll ?? 0) > 0.5;
  const plane = (
    <mesh position={[0, planeH / 2, 0]} renderOrder={14}>
      <planeGeometry args={[planeW, planeH]} />
      <meshStandardMaterial
        {...(texture ? { map: texture } : {})}
        color={texture ? '#ffffff' : '#1c1c28'}
        transparent
        opacity={opacity}
        roughness={0.48}
        metalness={0.04}
        envMapIntensity={1.15}
        side={THREE.DoubleSide}
        alphaTest={0.08}
        depthWrite={opacity >= 0.99}
      />
    </mesh>
  );

  return (
    <>
      {lockFacing ? plane : <YawBillboard>{plane}</YawBillboard>}
      {!displayOnly && (
        <TokenPickVolume itemId={item.id} radius={footprint * 0.52} height={planeH} y={0} />
      )}
    </>
  );
}

function GlbProp({ item, propId }: { item: ImageItem; propId: string }) {
  const open = (item.propState ?? 0) > 0;
  const light = propModelLight(propId);
  const len = Math.max(item.width, 8);
  const depth = Math.max(item.height, 8);
  const animSize = Math.max(len, depth);
  const fallback = hasPropMesh3D(propId) ? (
    <MeshProp item={item} propId={propId} />
  ) : hasPropCanvasArt(propId) ? (
    <PropArtBillboard item={item} propId={propId} />
  ) : (
    <MeshProp item={item} propId={propId} />
  );
  return (
    <PropGlbErrorBoundary fallback={fallback}>
      <PropAnim3D
        item={item}
        size={animSize}
        {...(light ? { light } : {})}
        driveGroup
      >
        <PropModel3D propId={propId} open={open} size={len} depth={depth} />
      </PropAnim3D>
    </PropGlbErrorBoundary>
  );
}

function MeshProp({
  item,
  propId,
  wallHeight,
}: {
  item: ImageItem;
  propId: string;
  wallHeight?: number;
}) {
  const amount = useLivePropAmount(item);
  const doorStyleId = useMapStore((s) => s.doorStyleId);
  const doorTheme = resolveDoorSurfaceStyle(item.propDoorTheme || doorStyleId);
  const secretConcealed = propId === 'secret-door' && item.visible === false;
  const doorLongAxisX = isDoorPropId(propId) ? item.width >= item.height : undefined;
  const len = Math.max(item.width, 8);
  const depth = Math.max(item.height, 8);
  const animSize = Math.max(len, depth);
  return (
    <PropAnim3D item={item} size={animSize} driveGroup={false}>
      <PropMesh3D
        propId={propId}
        amount={amount}
        size={len}
        depth={depth}
        doorTheme={doorTheme}
        secretConcealed={secretConcealed}
        {...(wallHeight != null ? { height: wallHeight } : {})}
        {...(doorLongAxisX != null ? { doorLongAxisX } : {})}
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
  const footprint = Math.max(item.width, item.height, 8);
  const wallHeight = isDoor ? gridSize * wallHeightCells : undefined;
  // Prefer real 3D (GLB → procedural mesh) over flat canvas billboards.
  const useGlb = Boolean(propId && hasPropModel3D(propId));
  const useMesh = Boolean(propId && !useGlb && hasPropMesh3D(propId));
  const useCanvasBillboard = Boolean(
    propId && !useGlb && !useMesh && hasPropCanvasArt(propId),
  );

  const meshBase = useRef({ w: item.width, h: item.height });
  if (meshBase.current.w !== item.width || meshBase.current.h !== item.height) {
    meshBase.current = { w: item.width, h: item.height };
  }

  const wallLift =
    item.propMount === 'wall'
      ? Math.max(8, (item.propWallHeightCells ?? 1.15) * gridSize)
      : item.propWallMerge === true
        // Floor merge: bury past surface pad so chests / rugs sit flush in the floor.
        ? -Math.max(12, footprint * 0.34)
        : 0;
  const pickH = wallHeight
    ?? Math.max(
      useGlb ? footprint * 1.45 : footprint * 1.15,
      28,
      wallLift + footprint * 0.6,
    );

  return (
    <SceneItemTransformGroup
      itemId={item.id}
      surfaceY="ground"
      wallLift={wallLift}
      baseWidth={meshBase.current.w}
      baseHeight={meshBase.current.h}
      displayOnly={displayOnly}
    >
      {propId && useGlb ? (
        <>
          <Suspense
            fallback={
              <MeshProp
                item={item}
                propId={propId}
                {...(wallHeight != null ? { wallHeight } : {})}
              />
            }
          >
            <GlbProp item={item} propId={propId} />
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
      ) : propId && useCanvasBillboard ? (
        <>
          <PropArtBillboard item={item} propId={propId} displayOnly={displayOnly} />
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
