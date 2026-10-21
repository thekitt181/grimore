import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { isMobileClient } from '@/lib/socket';
import { getActiveMap, useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { isSceneItemOnTable, sceneMapsForClient } from '@/systems/scene/sceneMapsForClient';
import { useSessionStore } from '@/store/sessionStore';
import { sceneRefs } from '@/systems/scene/sceneRefs';
import { sceneCameraRef } from './sceneCameraRef';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { DrawItem, MapItem, TextItem } from '@/systems/scene/types';
import { Map3DGround } from './Map3DGround';
import { Map3DScannedScene } from './Map3DScannedScene';
import { Map3DWalls } from './Map3DWalls';
import { Map3DTokens } from './Map3DTokens';
import { Map3DDrawings } from './Map3DDrawings';
import { Map3DSurfaceDecals } from './Map3DSurfaceDecals';
import { WallDebrisBurst } from './WallDebrisBurst';
import { Map3DImageLayer } from './Map3DImages';
import { Map3DMapModel } from './Map3DMapModel';
import { Map3DFogOfWar } from './Map3DFogOfWar';
import { SyncedPixiOrthographicCamera } from './SyncedPixiCamera';
import { applyOrthographicCameraFromViewport } from './orthographicCameraSync';
import { useVisibleSceneTokens } from './useVisibleSceneTokens';
import { Map3DTokenGizmo } from './Map3DTokenGizmo';
import { MapPickVolume } from './MapPickVolume';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { pixiRenderResolution } from './pixiCanvasMetrics';
import { bindWebGLContextRecovery } from './threeWebGLContext';
import { markThreeFrameRendered, registerThreeRenderer, resetThreeCanvasHealth, notifyThreeCanvasUnhealthy } from './threeCanvasHealth';
import { applyPixiViewMode } from '@/systems/map/applyPixiViewMode';
import { FirstPersonCamera } from './FirstPersonCamera';
import { useFirstPersonStore } from './firstPersonStore';
import { useFirstPersonControls } from './useFirstPersonControls';
import { FpPaintSampler } from './FpPaintSampler';
import { FirstPersonVisionFog } from './FirstPersonVisionFog';
import { FpTrapImpactSparks } from './FpTrapImpact';
import { Environment } from '@react-three/drei';
import { warmMap3DAssets } from './warmMap3DAssets';
import { preloadPropModels3D } from './PropModel3D';

/** Stable defaults — position/zoom owned by SyncedPixiOrthographicCamera (never reset on re-render). */
function useStableOrthoCameraDefaults() {
  return useMemo(() => ({ near: -4500, far: 4500, zoom: 1 }), []);
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

/** 2D view: GLB map + fog (Pixi fog sits under this Three overlay). */
function Map2DModelFogContent({ map, showGizmo = false }: { map: MapItem; showGizmo?: boolean }) {
  return (
    <>
      <Map3DMapModel map={map} showGizmo={showGizmo} />
      <Map3DFogOfWar map={map} />
    </>
  );
}

/** 2D view: every token with a GLB/STL draws as a 3D mini (not flat Pixi art). */
function TokenModelOverlayLayer() {
  const { tokens, activeTurnItemId } = useVisibleSceneTokens({ modelOnly: true });
  if (tokens.length === 0) return null;

  return (
    <Map3DTokens
      tokens={tokens}
      {...(activeTurnItemId ? { activeTurnItemId } : {})}
    />
  );
}

function TokenOverlay2DContent({ map }: { map: MapItem | null }) {
  const activeTool = useMapStore((s) => s.activeTool);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const hasModelMap = Boolean(map?.modelUrl);
  const showMapGizmo = Boolean(
    map &&
      activeTool === 'select' &&
      selectedIds.length === 1 &&
      selectedIds[0] === map.id &&
      map.modelUrl,
  );
  return (
    <>
      <ambientLight intensity={0.62} color="#fff8ef" />
      <directionalLight position={[420, 920, 280]} intensity={1.45} color="#fff5e6" />
      <directionalLight position={[-360, 640, -220]} intensity={0.5} color="#ffd4a8" />
      <directionalLight position={[80, 520, -620]} intensity={0.35} color="#ffffff" />
      <Suspense fallback={null}>
        {hasModelMap && map ? <Map2DModelFogContent map={map} showGizmo={showMapGizmo} /> : null}
        <TokenModelOverlayLayer />
      </Suspense>
    </>
  );
}

function Map3DSceneContent() {
  const items = useItemStore(selectSortedItems);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const activeTool = useMapStore((s) => s.activeTool);
  const selectedIds = useItemStore((s) => s.selectedIds);
  const gm = useSessionStore((s) => s.myRole === 'GM');
  const gizmoMapId =
    activeTool === 'select' && selectedIds.length === 1 ? selectedIds[0] : undefined;
  const mobile = isMobileClient();
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
  const firstPerson = useFirstPersonStore((s) => s.enabled);
  /** Authored/scanned walls in 3D for DM and players (auto-extrude still toggles image scans). */
  const showExtrudedWallsFor = (map: MapItem) =>
    autoExtrudeWalls || firstPerson || map.walls.length > 0;

  const maps = useMemo(
    () => sceneMapsForClient(items, gm),
    [items, gm],
  );
  const drawings = items.filter((i): i is DrawItem => i.type === 'drawing' && isSceneItemOnTable(i, gm));
  const labels = items.filter((i): i is TextItem => i.type === 'text' && isSceneItemOnTable(i, gm));

  const gridSize = activeMap?.gridSize ?? 96;
  const wallHeight = gridSize * wallHeightCells;
  const wallThickness = Math.max(4, gridSize * 0.12);

  return (
    <>
      <ambientLight intensity={1.05} />
      <directionalLight position={[800, 1400, 500]} intensity={1.35} castShadow={!mobile} />
      <directionalLight position={[-400, 900, -400]} intensity={0.65} />
      <hemisphereLight args={['#f0ece4', '#2a2520', 0.55]} />
      <Suspense fallback={null}>
        <Environment
          preset="warehouse"
          environmentIntensity={firstPerson ? 0.34 : 0.44}
        />
      </Suspense>
      {maps.map((map) => (
        <group key={map.id}>
          <Map3DGround map={map} clayMode={scanImageWalls} skipFloor={Boolean(map.modelUrl)} />
          {showExtrudedWallsFor(map) && scanImageWalls && (
            <Map3DScannedScene map={map} wallHeight={wallHeight} />
          )}
          {showExtrudedWallsFor(map) && !scanImageWalls && map.walls.length > 0 && (
            <Map3DWalls map={map} wallHeight={wallHeight} wallThickness={wallThickness} />
          )}
          <Map3DMapModel map={map} showGizmo={map.id === gizmoMapId && Boolean(map.modelUrl)} />
          {/* Ground-plane FoW is top-down only; FP uses FirstPersonVisionFog (torch/DV). */}
          {!firstPerson && <Map3DFogOfWar map={map} />}
          {!map.modelUrl && <MapPickGroup map={map} />}
        </group>
      ))}

      <TokenLayer />
      <Map3DDrawings drawings={drawings} labels={labels} />
      <Map3DSurfaceDecals />
      <WallDebrisBurst />
      <FpPaintSampler />
      <Map3DImageLayer />
      {firstPerson && <FirstPersonVisionFog wallHeight={wallHeight} />}
      {firstPerson && <FpTrapImpactSparks />}
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
  width: '100%',
  height: '100%',
  touchAction: 'none' as const,
  pointerEvents: 'none' as const,
};

function onThreeCanvasCreated(state: RootState): void {
  const { gl, scene } = state;
  gl.setClearColor(0x000000, 0);
  gl.domElement.style.pointerEvents = 'none';
  gl.domElement.style.width = '100%';
  gl.domElement.style.height = '100%';
  gl.domElement.style.display = 'block';
  sceneRefs.threeCanvas.current = gl.domElement;
  registerThreeRenderer(gl);
  void import('@/systems/scene/token/remotePoseApply').then(({ registerThreeScene }) => {
    registerThreeScene(scene);
  });

  if (state.camera instanceof THREE.OrthographicCamera) {
    applyOrthographicCameraFromViewport(state.camera, state.size.width, state.size.height);
  }
}

function WebGLContextGuard({ onContextLost }: { onContextLost: () => void }) {
  const gl = useThree((s) => s.gl);
  useEffect(() => bindWebGLContextRecovery(gl, onContextLost), [gl, onContextLost]);
  return null;
}

/** Notify Pixi layers once Three.js has drawn a healthy frame (mobile fallback off). */
function ThreeReadyNotifier() {
  useFrame(() => {
    markThreeFrameRendered();
  });
  return null;
}

/** Opaque scene background in 3D/FP so the Pixi map image cannot show through as a fake floor. */
function SceneBackground() {
  const is3d = useMapStore((s) => s.viewMode === '3d');
  if (!is3d) return null;
  return <color attach="background" args={['#1e1e22']} />;
}

function CanvasResizeSync() {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const sync = () => invalidate();
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', sync);
    return () => {
      window.removeEventListener('resize', sync);
      window.removeEventListener('orientationchange', sync);
    };
  }, [invalidate]);
  return null;
}

/** FP toggles DPR/shadows without remounting the Canvas (remount = full texture + prop reload). */
function FpCanvasTuning() {
  const viewMode = useMapStore((s) => s.viewMode);
  const firstPerson = useFirstPersonStore((s) => s.enabled) && viewMode === '3d';
  const gl = useThree((s) => s.gl);
  const mobile = isMobileClient();

  useEffect(() => {
    const dpr = firstPerson
      ? Math.min(mobile ? 1 : 1.25, pixiRenderResolution())
      : pixiRenderResolution();
    gl.setPixelRatio(dpr);
    gl.shadowMap.enabled = !firstPerson && !mobile;
  }, [firstPerson, gl, mobile]);

  return null;
}

/** Three.js overlay: full scene in 3D view; model tokens only in 2D view. */
export function MapSceneCanvas() {
  const viewMode = useMapStore((s) => s.viewMode);
  const is3d = viewMode === '3d';
  const firstPerson = useFirstPersonStore((s) => s.enabled) && is3d;
  useFirstPersonControls();
  const [glKey, setGlKey] = useState(0);

  useEffect(() => {
    if (viewMode !== '3d' && useFirstPersonStore.getState().enabled) {
      useFirstPersonStore.getState().setEnabled(false);
    }
  }, [viewMode]);

  useEffect(() => {
    if (!is3d) return;
    preloadPropModels3D();
    void warmMap3DAssets();
  }, [is3d]);

  const wallStyleId = useMapStore((s) => s.wallStyleId);
  const floorStyleId = useMapStore((s) => s.floorStyleId);
  useEffect(() => {
    if (!is3d) return;
    void warmMap3DAssets();
  }, [is3d, wallStyleId, floorStyleId]);

  const onContextLost = useCallback(() => {
    sceneRefs.threeCanvas.current = null;
    sceneCameraRef.liveCamera = null;
    resetThreeCanvasHealth();
    notifyThreeCanvasUnhealthy();
    applyPixiViewMode(useMapStore.getState().viewMode === '3d');
    setGlKey((k) => k + 1);
  }, []);

  const items = useItemStore(selectSortedItems);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const overlayMap = useMemo(() => {
    void items;
    void activeMapId;
    return getActiveMap();
  }, [items, activeMapId]);

  const { tokens: modelCandidates } = useVisibleSceneTokens({ modelOnly: true });
  const hasModelTokens = modelCandidates.length > 0;

  const hasModelMap = Boolean(overlayMap?.modelUrl);
  const needsThreeOverlay = is3d || hasModelTokens || hasModelMap;

  const orthoDefaults = useStableOrthoCameraDefaults();
  const fpPerspectiveCamera = useMemo(
    () => ({ fov: 72, near: 0.12, far: 8000, position: [0, 120, 0] as [number, number, number] }),
    [],
  );

  const mobile = isMobileClient();
  const glProps = {
    antialias: !mobile,
    alpha: true,
    powerPreference: (mobile ? 'default' : 'high-performance') as WebGLPowerPreference,
    failIfMajorPerformanceCaveat: false,
  };
  // FP on dense GLB maps: match dungeon responsiveness — lower pixel load, no shadows.
  const dpr = firstPerson
    ? Math.min(mobile ? 1 : 1.25, pixiRenderResolution())
    : pixiRenderResolution();
  const useShadows = !firstPerson && !mobile && (is3d || hasModelTokens);

  useEffect(() => () => {
    sceneRefs.threeCanvas.current = null;
    sceneCameraRef.liveCamera = null;
    resetThreeCanvasHealth();
  }, [glKey]);

  useEffect(() => {
    if (!needsThreeOverlay) return;
    const onResize = () => {
      const canvas = sceneRefs.threeCanvas.current;
      if (!canvas) return;
      canvas.style.width = '100%';
      canvas.style.height = '100%';
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, [needsThreeOverlay]);

  const handleCreated = useCallback((state: RootState) => {
    onThreeCanvasCreated(state);
  }, []);

  if (!needsThreeOverlay) return null;

  return (
    <Canvas
      key={glKey}
      orthographic={is3d && !firstPerson}
      shadows={useShadows}
      frameloop="always"
      camera={
        firstPerson
          ? fpPerspectiveCamera
          : is3d
            ? orthoDefaults
            : { position: [1280, 1500, 960], zoom: 1, near: -4500, far: 4500 }
      }
      style={canvasStyle}
      gl={glProps}
      dpr={dpr}
      resize={{ scroll: false, debounce: 0 }}
      onCreated={handleCreated}
    >
      <WebGLContextGuard onContextLost={onContextLost} />
      <ThreeReadyNotifier />
      <CanvasResizeSync />
      <FpCanvasTuning />
      {firstPerson ? <FirstPersonCamera /> : <SyncedPixiOrthographicCamera />}
      <SceneBackground />
      <Suspense fallback={null}>
        {is3d ? (
          <>
            <Map3DSceneContent />
            {!firstPerson && <Map3DTokenGizmo />}
          </>
        ) : (
          <TokenOverlay2DContent map={overlayMap} />
        )}
      </Suspense>
    </Canvas>
  );
}

/** @deprecated use MapSceneCanvas */
export const Map3DCanvas = MapSceneCanvas;
