import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { useMapStore } from '@/systems/map/store/mapStore';
import { Map3DTokens } from './Map3DTokens';
import { SyncedPixiOrthographicCamera } from './SyncedPixiCamera';
import { useVisibleSceneTokens } from './useVisibleSceneTokens';

/** Renders GLB/STL token models over the 2D Pixi map (Pixi handles input + fog). */
export function Map2DTokenModels() {
  const viewport = useMapStore((s) => s.viewport);
  const { tokens, activeTurnItemId } = useVisibleSceneTokens();

  if (tokens.length === 0) return null;

  return (
    <div
      className="absolute inset-0"
      style={{ pointerEvents: 'none' }}
      aria-hidden
    >
      <Canvas
        orthographic
        gl={{ antialias: true, alpha: true }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      >
        <ambientLight intensity={0.85} />
        <directionalLight position={[400, 800, 300]} intensity={0.9} />
        <SyncedPixiOrthographicCamera viewport={viewport} />
        <Suspense fallback={null}>
          <Map3DTokens
            tokens={tokens}
            orthographicLabels
            {...(activeTurnItemId ? { activeTurnItemId } : {})}
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
