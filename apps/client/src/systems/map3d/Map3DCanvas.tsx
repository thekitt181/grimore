import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { RootState } from '@react-three/fiber';
import * as THREE from 'three';
import { isMobileClient } from '@/lib/socket';
import { getActiveMap, useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { sceneMapsForClient } from '@/systems/scene/sceneMapsForClient';
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
import { is3dToken } from '@/systems/scene/token/tokenRenderType';
import { markThreeFrameRendered, registerThreeRenderer, resetThreeCanvasHealth, notifyThreeCanvasUnhealthy, THREE_READY_EVENT } from './threeCanvasHealth';
import { applyPixiViewMode } from '@/systems/map/applyPixiViewMode';

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

/** 2D view: GLB map + fog (Pixi fog sits under this Three overlay). */
function Map2DModelFogContent({ map }: { map: MapItem }) {
  return (
    <>
      <Map3DMapModel map={map} />
      <Map3DFogOfWar map={map} />
    </>
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

function TokenOverlay2DContent({ map }: { map: MapItem | null }) {
  const hasModelMap = Boolean(map?.modelUrl);
  return (
    <>
      <ambientLight intensity={0.62} color="#fff8ef" />
      <directionalLight position={[420, 920, 280]} intensity={1.45} color="#fff5e6" />
      <directionalLight position={[-360, 640, -220]} intensity={0.5} color="#ffd4a8" />
      <directionalLight position={[80, 520, -620]} intensity={0.35} color="#ffffff" />
      <Suspense fallback={null}>
        {hasModelMap && map ? <Map2DModelFogContent map={map} /> : null}
        <TokenModelOverlayLayer />
      </Suspense>
    </>
  );
}

function Map3DSceneContent() {
  const items = useItemStore(selectSortedItems);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const myRole = useSessionStore((s) => s.myRole);
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

  const maps = useMemo(
    () => sceneMapsForClient(items, activeMapId, myRole === 'GM'),
    [items, activeMapId, myRole],
  );
  const drawings = items.filter((i): i is DrawItem => i.type === 'drawing');
  const labels = items.filter((i): i is TextItem => i.type === 'text');

  const gridSize = activeMap?.gridSize ?? 96;
  const wallHeight = gridSize * wallHeightCells;
  const wallThickness = Math.max(4, gridSize * 0.12);

  return (
    <>
      <ambientLight intensity={1.05} />
      <directionalLight position={[800, 1400, 500]} intensity={1.35} castShadow={!mobile} />
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
  width: '100%',
  height: '100%',
  touchAction: 'none' as const,
  pointerEvents: 'none' as const,
};

function onThreeCanvasCreated(state: RootState): void {
  const { gl } = state;
  gl.setClearColor(0x000000, 0);
  gl.domElement.style.pointerEvents = 'none';
  gl.domElement.style.width = '100%';
  gl.domElement.style.height = '100%';
  gl.domElement.style.display = 'block';
  sceneRefs.threeCanvas.current = gl.domElement;
  registerThreeRenderer(gl);

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

/** Opaque scene background only after Three is ready — keeps Pixi map visible underneath on mobile. */
function SceneBackground() {
  const mobile = isMobileClient();
  const is3d = useMapStore((s) => s.viewMode === '3d');
  const [opaque, setOpaque] = useState(!mobile || !is3d);

  useEffect(() => {
    if (!mobile || !is3d) {
      setOpaque(true);
      return;
    }
    setOpaque(false);
    const onReady = () => setOpaque(true);
    window.addEventListener(THREE_READY_EVENT, onReady);
    return () => window.removeEventListener(THREE_READY_EVENT, onReady);
  }, [mobile, is3d]);

  if (!is3d || !opaque) return null;
  return <color attach="background" args={['#1e1e22']} />;
}

/** Three.js overlay: full scene in 3D view; model tokens only in 2D view. */
export function MapSceneCanvas() {
  const viewMode = useMapStore((s) => s.viewMode);
  const is3d = viewMode === '3d';
  const [glKey, setGlKey] = useState(0);
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
  const hasModelTokens = useMemo(
    () => modelCandidates.some(is3dToken),
    [modelCandidates],
  );

  const hasModelMap = Boolean(overlayMap?.modelUrl);
  const needsThreeOverlay = is3d || hasModelTokens || hasModelMap;

  const orthoDefaults = useStableOrthoCameraDefaults();

  const mobile = isMobileClient();
  const glProps = {
    antialias: !mobile,
    alpha: true,
    powerPreference: (mobile ? 'default' : 'high-performance') as WebGLPowerPreference,
    failIfMajorPerformanceCaveat: false,
  };
  const dpr = pixiRenderResolution();
  const useShadows = !mobile && is3d;

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
      orthographic
      shadows={useShadows}
      frameloop="always"
      camera={is3d ? orthoDefaults : { position: [1280, 1500, 960], zoom: 1, near: 0.1, far: 8000 }}
      style={canvasStyle}
      gl={glProps}
      dpr={dpr}
      resize={{ scroll: false, debounce: 0 }}
      onCreated={handleCreated}
    >
      <WebGLContextGuard onContextLost={onContextLost} />
      <ThreeReadyNotifier />
      <SyncedPixiOrthographicCamera />
      <SceneBackground />
      <Suspense fallback={null}>
        {is3d ? (
          <>
            <Map3DSceneContent />
            <Map3DTokenGizmo />
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
