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
import { SyncedPixiPerspectiveCamera } from './SyncedPixiCamera';
import { useVisibleSceneTokens } from './useVisibleSceneTokens';
import { Map3DFog } from './Map3DFog';

function ViewportCamera({ span }: { span: number }) {
  const viewport = useMapStore((s) => s.viewport);
  return <SyncedPixiPerspectiveCamera viewport={viewport} span={span} />;
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
  const { tokens, activeTurnItemId } = useVisibleSceneTokens();
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
      <ambientLight intensity={0.72} />
      <directionalLight position={[800, 1400, 500]} intensity={0.95} castShadow shadow-mapSize={[2048, 2048]} />
      <directionalLight position={[-400, 600, -300]} intensity={0.35} />

      {maps.map((map) => (
        <group key={map.id}>
          <Map3DGround map={map} clayMode={scanImageWalls} />
          {autoExtrudeWalls && scanImageWalls && (
            <Map3DScannedScene map={map} wallHeight={wallHeight} />
          )}
          {autoExtrudeWalls && !scanImageWalls && map.walls.length > 0 && (
            <Map3DWalls map={map} wallHeight={wallHeight} wallThickness={wallThickness} />
          )}
          <Map3DMapModel map={map} />
        </group>
      ))}

      <Map3DTokens
        tokens={tokens}
        {...(activeTurnItemId ? { activeTurnItemId } : {})}
      />
      <Map3DDrawings drawings={drawings} labels={labels} />

      <Map3DFog span={span} />
      <ViewportCamera span={span} />
    </>
  );
}

export function Map3DCanvas() {
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
      shadows
      camera={{
        position: [cx + camDist, camY, cz + camDist],
        fov: 45,
        near: 1,
        far: Math.max(span * 8, 20000),
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 0, touchAction: 'none', pointerEvents: 'none' }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#1e1e22']} />
      <Suspense fallback={null}>
        <Map3DSceneContent />
      </Suspense>
    </Canvas>
  );
}
