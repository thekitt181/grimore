import { Suspense, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { Map3DMapModel } from '@/systems/map3d/Map3DMapModel';
import { SyncedPixiTopDownDisplayCamera } from '@/systems/map3d/SyncedPixiCamera';
import { pixiRenderResolution } from '@/systems/map3d/pixiCanvasMetrics';
import { isMobileClient } from '@/lib/socket';
import { Map3DTokens } from '@/systems/map3d/Map3DTokens';
import { useVisibleSceneTokens } from '@/systems/map3d/useVisibleSceneTokens';
import { tokenUsesModelMesh } from '@/systems/scene/token/tokenRenderType';

function Gm2dUnderlayScene({
  map,
  tokens,
  activeTurnItemId,
}: {
  map: NonNullable<ReturnType<typeof getActiveMap>>;
  tokens: ReturnType<typeof useVisibleSceneTokens>['tokens'];
  activeTurnItemId?: string;
}) {
  return (
    <>
      <SyncedPixiTopDownDisplayCamera />
      <ambientLight intensity={0.62} color="#fff8ef" />
      <directionalLight position={[420, 920, 280]} intensity={1.45} color="#fff5e6" />
      <directionalLight position={[-360, 640, -220]} intensity={0.5} color="#ffd4a8" />
      <directionalLight position={[80, 520, -620]} intensity={0.35} color="#ffffff" />
      <Suspense fallback={null}>
        {/* Map GLB only — props + flat 2D tokens stay as Pixi sprites above this canvas. */}
        {map.modelUrl ? <Map3DMapModel map={map} displayOnly /> : null}
        {/* GLB minis only — flat tokens are Pixi (DOM above underlay). */}
        <group renderOrder={20}>
          <Map3DTokens
            tokens={tokens}
            forceTabletop
            displayOnly
            showSelectionGizmo={false}
            {...(activeTurnItemId ? { activeTurnItemId } : {})}
          />
        </group>
      </Suspense>
    </>
  );
}

const canvasStyle = {
  position: 'absolute' as const,
  inset: 0,
  width: '100%',
  height: '100%',
  zIndex: 0,
  touchAction: 'none' as const,
  pointerEvents: 'none' as const,
};

/**
 * Top-down Three underlay for the GM 2D editor: map GLB + GLB token minis.
 * Flat 2D tokens stay in Pixi (z-index above this canvas) so the map mesh
 * cannot bury them. Props stay Pixi too.
 */
export function Gm2dEditorMapUnderlay() {
  const items = useItemStore((s) => s.items);
  const activeMapId = useItemStore((s) => s.activeMapId);
  const map = useMemo(() => {
    void items;
    void activeMapId;
    return getActiveMap();
  }, [items, activeMapId]);

  const { tokens: allTokens, activeTurnItemId } = useVisibleSceneTokens();
  const tokens = useMemo(
    () => allTokens.filter((t) => tokenUsesModelMesh(t)),
    [allTokens],
  );

  if (!map) return null;
  if (!map.modelUrl && tokens.length === 0) return null;

  const mobile = isMobileClient();
  const glProps = {
    antialias: !mobile,
    alpha: true,
    powerPreference: (mobile ? 'default' : 'high-performance') as WebGLPowerPreference,
    failIfMajorPerformanceCaveat: false,
  };

  return (
    <Canvas
      orthographic
      frameloop="always"
      shadows={!mobile}
      camera={{ near: -4500, far: 4500, zoom: 1 }}
      style={canvasStyle}
      gl={glProps}
      dpr={pixiRenderResolution()}
      resize={{ scroll: false, debounce: 0 }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0);
        gl.domElement.style.pointerEvents = 'none';
        gl.domElement.style.zIndex = '0';
        gl.domElement.style.width = '100%';
        gl.domElement.style.height = '100%';
        gl.domElement.style.display = 'block';
      }}
    >
      <Gm2dUnderlayScene
        map={map}
        tokens={tokens}
        {...(activeTurnItemId ? { activeTurnItemId } : {})}
      />
    </Canvas>
  );
}
