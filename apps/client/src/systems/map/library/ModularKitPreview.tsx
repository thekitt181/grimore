import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { SceneModel } from '@/systems/map3d/SceneModel';
import { MAP_MODEL_YAW } from '@/systems/map3d/mapModelYaw';
import { modularDepthStretch, modularWidthStretch, type ModularPiece } from './modularKits';

function PreviewScene({ piece }: { piece: ModularPiece }) {
  return (
    <>
      <ambientLight intensity={0.85} color="#fff8ef" />
      <directionalLight position={[6, 10, 4]} intensity={1.55} color="#fff5e6" />
      <directionalLight position={[-4, 6, -3]} intensity={0.45} color="#ffd4a8" />
      <group rotation={[0, MAP_MODEL_YAW, 0]}>
        <SceneModel
          url={piece.url}
          targetSize={5.4}
          groundAlign
          depthStretch={modularDepthStretch(piece)}
          widthStretch={modularWidthStretch(piece)}
        />
      </group>
    </>
  );
}

export function ModularKitPreview({ piece }: { piece: ModularPiece }) {
  return (
    <div
      className="relative w-full overflow-hidden rounded border border-[#2a2a3a]"
      style={{ height: 132, background: '#12121a' }}
    >
      <Canvas
        orthographic
        dpr={[1, 1.5]}
        frameloop="always"
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [6.2, 7.4, 6.2], zoom: 22, near: -80, far: 80 }}
        onCreated={({ camera, invalidate }) => {
          camera.lookAt(0, 1.2, 0);
          invalidate();
        }}
        style={{ width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <Suspense fallback={null}>
          <PreviewScene key={piece.url} piece={piece} />
        </Suspense>
      </Canvas>
      <div className="pointer-events-none absolute bottom-1 left-1.5 right-1.5 font-ui text-[10px] text-[#e8e0d0] truncate">
        {piece.title}
        <span className="text-[#8a8075]"> · {piece.w}×{piece.h}m</span>
      </div>
    </div>
  );
}
