import { Suspense, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import type { WebGLRenderer } from 'three';
import * as THREE from 'three';
import { useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { sceneCameraRef } from './sceneCameraRef';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { DrawItem, MapItem, TextItem } from '@/systems/scene/types';
import { Map3DGround } from './Map3DGround';
import { Map3DScannedScene } from './Map3DScannedScene';
import { Map3DWalls } from './Map3DWalls';
import { Map3DTokens } from './Map3DTokens';
import { Map3DDrawings } from './Map3DDrawings';
import { Map3DMapModel } from './Map3DMapModel';
import { Map3DFogOfWar } from './Map3DFogOfWar';
import { SyncedPixiOrthographicCamera, SyncedPixiPerspectiveCamera } from './SyncedPixiCamera';
import { applyOrthographicCameraFromViewport } from './orthographicCameraSync';
import { useVisibleSceneTokens } from './useVisibleSceneTokens';
import { Map3DTokenGizmo } from './Map3DTokenGizmo';
import { MapPickVolume } from './MapPickVolume';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { pixiRenderResolution } from './pixiCanvasMetrics';
import { is3dToken } from '@/systems/scene/token/tokenRenderType';

/** Stable defaults — position/zoom owned by SyncedPixiOrthographicCamera (never reset on re-render). */
function useStableOrthoCameraDefaults() {
  return useMemo(() => ({ near: 0.1, far: 8000, zoom: 1 }), []);
}

function TokenLayer() {
  const { tokens, activeTurnItemId } = useVisibleSceneTokens();
  return (
    <Map3DTokens
      tokens={tokens}
      {...(activeTurnItemId ? { activeTurnItemId } : {})}
    />
  );
}

/** 2D view: model mesh in Three; Pixi draws the selection gizmo (same as flat tokens). */
function TokenModelOverlayLayer() {
  const { tokens, activeTurnItemId } = useVisibleSceneTokens({ modelOnly: true });
  const modelTokens = useMemo(() => tokens.filter(is3dToken), [tokens]);
  if (modelTokens.length === 0) return null;

  return (
    <Map3DTokens
      tokens={modelTokens}
      showSelectionGizmo={false}
      {...(activeTurnItemId ? { activeTurnItemId } : {})}
    />
  );
}

function TokenOverlay2DContent() {
  return (
    <>
      <SyncedPixiOrthographicCamera />
      <ambientLight intensity={0.62} color="#fff8ef" />
      <directionalLight position={[420, 920, 280]} intensity={1.45} color="#fff5e6" />
      <directionalLight position={[-360, 640, -220]} intensity={0.5} color="#ffd4a8" />
      <directionalLight position={[80, 520, -620]} intensity={0.35} color="#ffffff" />
      <Suspense fallback={null}>
        <TokenModelOverlayLayer />
      </Suspense>
    </>
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
          <Map3DFogOfWar map={map} />
          <MapPickGroup map={map} />
        </group>
      ))}

      <TokenLayer />
      <Map3DDrawings drawings={drawings} labels={labels} />
    </>
  );
}

function MapPickGroup({ map }: { map: MapItem }) {
  return (
    <SceneItemTransformGroup itemId={map.id} surfaceY={0} baseWidth={map.width} baseHeight={map.height}>
      <MapPickVolume map={map} />
    </SceneItemTransformGroup>
  );
}

const canvasStyle = {
  position: 'absolute' as const,
  inset: 0,
  touchAction: 'none' as const,
  pointerEvents: 'none' as const,
};

function onThreeCanvasCreated({ gl }: { gl: WebGLRenderer }) {
  gl.setClearColor(0x000000, 0);
  gl.domElement.style.pointerEvents = 'none';
  sceneRefs.threeCanvas.current = gl.domElement;
}

/** Sync ortho camera before the first painted frame so zoom matches 2D immediately. */
function on3dCanvasCreated(state: RootState) {
  onThreeCanvasCreated(state);
  if (state.camera instanceof THREE.OrthographicCamera) {
    applyOrthographicCameraFromViewport(state.camera, state.size.width, state.size.height);
  }
}

/** Three.js overlay: full scene in 3D view; model tokens only in 2D view. */
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

  const { tokens: modelCandidates } = useVisibleSceneTokens({ modelOnly: true });
  const hasModelTokens = useMemo(
    () => modelCandidates.some(is3dToken),
    [modelCandidates],
  );

  const orthoDefaults = useStableOrthoCameraDefaults();

  const glProps = {
    antialias: true,
    alpha: true,
  };
  const dpr = pixiRenderResolution();

  useEffect(() => () => {
    sceneRefs.threeCanvas.current = null;
    sceneCameraRef.liveCamera = null;
  }, [is3d, hasModelTokens]);

  if (!is3d && !hasModelTokens) return null;

  if (!is3d) {
    return (
      <Canvas
        orthographic
        frameloop="always"
        camera={{ position: [1280, 1500, 960], zoom: 1, near: 0.1, far: 8000 }}
        style={canvasStyle}
        gl={glProps}
        dpr={dpr}
        onCreated={onThreeCanvasCreated}
      >
        <TokenOverlay2DContent />
      </Canvas>
    );
  }

  return (
    <Canvas
      orthographic
      shadows
      frameloop="always"
      camera={orthoDefaults}
      style={canvasStyle}
      gl={glProps}
      dpr={dpr}
      onCreated={on3dCanvasCreated}
    >
      <color attach="background" args={['#1e1e22']} />
      <SyncedPixiOrthographicCamera />
      <Suspense fallback={null}>
        <Map3DSceneContent />
        <Map3DTokenGizmo />
      </Suspense>
    </Canvas>
  );
}

/** @deprecated use MapSceneCanvas */
export const Map3DCanvas = MapSceneCanvas;
