import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useSessionStore } from '@/store/sessionStore';
import type { DrawItem, MapItem, TextItem, TokenItem } from '@/systems/scene/types';
import { itemCenterXZ } from './coords';
import { Map3DGround } from './Map3DGround';
import { Map3DScannedScene } from './Map3DScannedScene';
import { Map3DWalls } from './Map3DWalls';
import { Map3DTokens } from './Map3DTokens';
import { Map3DDrawings } from './Map3DDrawings';

function SceneBounds({ maps }: { maps: MapItem[] }) {
  const targetRef = useRef(new THREE.Vector3());
  const { camera } = useThree();

  const center = useMemo(() => {
    if (maps.length === 0) return new THREE.Vector3(1280, 0, 960);
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const m of maps) {
      minX = Math.min(minX, m.x);
      minZ = Math.min(minZ, m.y);
      maxX = Math.max(maxX, m.x + m.width);
      maxZ = Math.max(maxZ, m.y + m.height);
    }
    return new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
  }, [maps]);

  const radius = useMemo(() => {
    if (maps.length === 0) return 2000;
    let maxSpan = 0;
    for (const m of maps) {
      maxSpan = Math.max(maxSpan, Math.hypot(m.width, m.height));
    }
    return maxSpan * 0.75;
  }, [maps]);

  useFrame(() => {
    targetRef.current.copy(center);
    if (camera.position.distanceTo(center) < radius * 0.35) {
      camera.position.set(center.x + radius, radius * 0.65, center.z + radius);
      camera.lookAt(center);
    }
  });

  return (
    <OrbitControls
      target={center}
      enablePan
      enableZoom
      enableRotate
      minDistance={radius * 0.15}
      maxDistance={radius * 3.5}
      maxPolarAngle={Math.PI / 2 - 0.08}
      minPolarAngle={0.15}
      dampingFactor={0.08}
      enableDamping
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
  const myRole = useSessionStore((s) => s.myRole);
  const activeTurnItemId = useInitiativeStore((s) =>
    s.isActive && s.combatants[s.currentIndex] ? s.combatants[s.currentIndex]!.tokenId : undefined,
  );

  const maps = items.filter((i): i is MapItem => i.type === 'map' && i.visible);
  const tokens = items.filter((i): i is TokenItem => {
    if (i.type !== 'token') return false;
    if (myRole === 'GM') return true;
    return i.visible;
  });
  const drawings = items.filter((i): i is DrawItem => i.type === 'drawing');
  const labels = items.filter((i): i is TextItem => i.type === 'text');

  const gridSize = activeMap?.gridSize ?? 96;
  const wallHeight = gridSize * wallHeightCells;
  const wallThickness = Math.max(4, gridSize * 0.12);

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
        </group>
      ))}

      <Map3DTokens
        tokens={tokens}
        {...(activeTurnItemId ? { activeTurnItemId } : {})}
      />
      <Map3DDrawings drawings={drawings} labels={labels} />

      <SceneBounds maps={maps.length > 0 ? maps : activeMap ? [activeMap] : []} />
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
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
      gl={{ antialias: true, alpha: false }}
    >
      <color attach="background" args={['#1e1e22']} />
      <fog attach="fog" args={['#1e1e22', span * 2, span * 6]} />
      <Suspense fallback={null}>
        <Map3DSceneContent />
      </Suspense>
    </Canvas>
  );
}
