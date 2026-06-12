import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { DrawItem, MapItem, TextItem } from '@/systems/scene/types';
import { itemCenterXZ } from './coords';
import { Map3DGround } from './Map3DGround';
import { Map3DScannedScene } from './Map3DScannedScene';
import { Map3DWalls } from './Map3DWalls';
import { Map3DTokens } from './Map3DTokens';
import { Map3DDrawings } from './Map3DDrawings';
import { Map3DMapModel } from './Map3DMapModel';
import { SyncedPixiOrthographicCamera, SyncedPixiPerspectiveCamera } from './SyncedPixiCamera';
import { useVisibleSceneTokens } from './useVisibleSceneTokens';
import { Map3DSelectionOutlines } from './Map3DSelectionOutlines';
import { MapPickVolume } from './MapPickVolume';
import { useLiveItemBounds } from './useLiveItemBounds';

function TokenLayer() {
  const { tokens, activeTurnItemId } = useVisibleSceneTokens();
  return (
    <Map3DTokens
      tokens={tokens}
      {...(activeTurnItemId ? { activeTurnItemId } : {})}
    />
  );
}

function Map3DSceneContent() {
  const items = useItemStore(selectSortedItems);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const activeMap = useMemo(() => {
    if (activeMapId) {
      const m = items.find((i) => i.id === activeMapId && i.type === 'map');
      if (m) return m as MapItem;
    }
    return (items.find((i) => i.type === 'map') as MapItem | undefined) ?? null;
  }, [items, activeMapId]);
  const autoExtrudeWalls = useMapStore((s) => s.autoExtrudeWalls);
  const scanImageWalls = useMapStore((s) => s.scanImageWalls);
  const wallHeightCells = useMapStore((s) => s.wallHeightCells);

  const maps = items.filter((i): i is MapItem => i.type === 'map' && i.visible);
  const drawings = items.filter((i): i is DrawItem => i.type === 'drawing');
  const labels = items.filter((i): i is TextItem => i.type === 'text');

  const gridSize = activeMap?.gridSize ?? 96;
  const wallHeight = gridSize * wallHeightCells;
  const wallThickness = Math.max(4, gridSize * 0.12);

  const span = useMemo(() => {
    const list = maps.length > 0 ? maps : activeMap ? [activeMap] : [];
    if (list.length === 0) return 2560;
    return Math.max(...list.map((m) => Math.max(m.width, m.height)));
  }, [maps, activeMap]);

  return (
    <>
      <ambientLight intensity={1.05} />
      <directionalLight position={[800, 1400, 500]} intensity={1.35} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-400, 900, -400]} intensity={0.65} />
      <hemisphereLight args={['#f0ece4', '#2a2520', 0.55]} />

      {maps.map((map) => (
        <group key={map.id}>
          <Map3DGround map={map} clayMode={scanImageWalls} skipFloor={Boolean(map.modelUrl)} />
          {autoExtrudeWalls && scanImageWalls && (
            <Map3DScannedScene map={map} wallHeight={wallHeight} />
          )}
          {autoExtrudeWalls && !scanImageWalls && map.walls.length > 0 && (
            <Map3DWalls map={map} wallHeight={wallHeight} wallThickness={wallThickness} />
          )}
          <Map3DMapModel map={map} />
          <MapPickGroup map={map} />
        </group>
      ))}

      <TokenLayer />
      <Map3DSelectionOutlines />
      <Map3DDrawings drawings={drawings} labels={labels} />
    </>
  );
}

function MapPickGroup({ map }: { map: MapItem }) {
  const { cx, cz, rotation } = useLiveItemBounds(map);
  return (
    <group position={[cx, 0, cz]} rotation={[0, (rotation * Math.PI) / 180, 0]}>
      <MapPickVolume map={map} />
    </group>
  );
}

function ViewportCamera() {
  return <SyncedPixiPerspectiveCamera />;
}

function TokenOverlayContent() {
  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[400, 800, 300]} intensity={0.9} />
      <SyncedPixiOrthographicCamera />
      <TokenLayer />
    </>
  );
}

/** Unified Three.js layer: 3D tokens in 2D + full 3D scene in 3D view. */
export function MapSceneCanvas() {
  const viewMode = useMapStore((s) => s.viewMode);
  const is3d = viewMode === '3d';
  const items = useItemStore(selectSortedItems);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const activeMap = useMemo(() => {
    if (activeMapId) {
      const m = items.find((i) => i.id === activeMapId && i.type === 'map');
      if (m) return m as MapItem;
    }
    return (items.find((i) => i.type === 'map') as MapItem | undefined) ?? null;
  }, [items, activeMapId]);

  const [cx, cz] = activeMap ? itemCenterXZ(activeMap) : [1280, 960];
  const span = activeMap ? Math.max(activeMap.width, activeMap.height) : 2560;
  const camY = span * 0.55;
  const camDist = span * 0.85;

  return (
    <Canvas
      shadows={is3d}
      orthographic={!is3d}
      frameloop="always"
      camera={
        is3d
          ? {
              position: [cx + camDist, camY, cz + camDist],
              fov: 45,
              near: 1,
              far: Math.max(span * 8, 20000),
            }
          : { position: [0, 0, 1000], zoom: 1, near: 0.1, far: 5000 }
      }
      style={{
        position: 'absolute',
        inset: 0,
        touchAction: 'none',
        pointerEvents: 'none',
      }}
      gl={{ antialias: true, alpha: true }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
      }}
    >
      {is3d ? (
        <>
          <color attach="background" args={['#1e1e22']} />
          <ViewportCamera />
          <Suspense fallback={null}>
            <Map3DSceneContent />
          </Suspense>
        </>
      ) : (
        <Suspense fallback={null}>
          <TokenOverlayContent />
        </Suspense>
      )}
    </Canvas>
  );
}

/** @deprecated use MapSceneCanvas */
export const Map3DCanvas = MapSceneCanvas;
