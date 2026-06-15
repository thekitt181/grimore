import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { isMobileClient } from '@/lib/socket';
import { useDiceStore, type DiceAnimationSpec } from './diceStore';
import { createDieGeometry, dieColor, normalizeDieSides } from './dieGeometry';

const GOLD = '#c9a84c';
const DURATION = 1.35;
/** How long dice stay visible after the roll animation finishes. */
const TRAY_HOLD_MS = 5500;

function layoutColumns(count: number): number {
  if (count <= 4) return count;
  if (count <= 9) return 3;
  if (count <= 16) return 4;
  return 6;
}

function layoutDicePositions(count: number): Array<{ x: number; z: number; scale: number }> {
  if (count <= 0) return [];
  if (count === 1) return [{ x: 0, z: 0, scale: 1 }];

  const cols = layoutColumns(count);
  const rows = Math.ceil(count / cols);
  const spacing = count > 12 ? 0.78 : count > 6 ? 0.92 : 1.05;
  const scale = count > 16 ? 0.62 : count > 12 ? 0.72 : count > 6 ? 0.84 : 1;

  return Array.from({ length: count }, (_, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    return {
      x: (col - (cols - 1) / 2) * spacing,
      z: (row - (rows - 1) / 2) * spacing * 0.85,
      scale,
    };
  });
}

function DieMesh({
  sides,
  value,
  dropped,
  index,
  layout,
}: {
  sides: number;
  value: number;
  dropped: boolean;
  index: number;
  layout: { x: number; z: number; scale: number };
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const start = useRef(performance.now() + index * 45);
  const kind = normalizeDieSides(sides);
  const geometry = useMemo(() => createDieGeometry(sides), [sides]);
  const { x, z, scale } = layout;

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const elapsed = (performance.now() - start.current) / 1000;
    const t = Math.min(1, elapsed / DURATION);
    const ease = 1 - Math.pow(1 - t, 3);

    if (t < 1) {
      mesh.rotation.x = ease * (Math.PI * 4 + value * 0.31);
      mesh.rotation.y = ease * (Math.PI * 3 + index * 0.7);
      mesh.rotation.z = ease * (Math.PI * 2 + kind * 0.08);
      mesh.position.y = 0.4 + Math.sin(t * Math.PI) * 1.1;
    } else {
      mesh.rotation.x = value * 0.17;
      mesh.rotation.y = index * 0.4 + kind * 0.05;
      mesh.rotation.z = 0;
      mesh.position.y = 0.35;
    }
  });

  return (
    <mesh ref={ref} geometry={geometry} position={[x, 0.35, z]} scale={scale} castShadow>
      <meshStandardMaterial
        color={dropped ? '#3f3f46' : dieColor(sides)}
        metalness={0.35}
        roughness={0.45}
        emissive={dropped ? '#000000' : GOLD}
        emissiveIntensity={dropped ? 0 : 0.08}
        transparent={dropped}
        opacity={dropped ? 0.45 : 1}
        flatShading
      />
      <Html center distanceFactor={8} style={{ pointerEvents: 'none' }}>
        <div
          className="font-display font-bold text-center select-none"
          style={{
            color: dropped ? '#71717a' : '#f5f0e6',
            fontSize: kind >= 12 ? 12 : scale < 0.85 ? 11 : 16,
            textShadow: '0 1px 4px rgba(0,0,0,0.9)',
          }}
        >
          {value}
        </div>
      </Html>
    </mesh>
  );
}

function TrayCamera({ diceCount }: { diceCount: number }) {
  const { camera } = useThree();
  const cols = layoutColumns(diceCount);
  const rows = Math.ceil(diceCount / cols);
  const camY = 3.2 + Math.max(0, rows - 2) * 0.55;
  const camZ = 5.5 + Math.max(0, rows - 2) * 0.4;

  useEffect(() => {
    camera.position.set(0, camY, camZ);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = diceCount > 9 ? 48 : 42;
      camera.updateProjectionMatrix();
    }
  }, [camera, camY, camZ, diceCount]);

  return null;
}

function DiceScene({ spec }: { spec: DiceAnimationSpec }) {
  const layouts = useMemo(() => layoutDicePositions(spec.faces.length), [spec.faces.length]);

  return (
    <>
      <TrayCamera diceCount={spec.faces.length} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[4, 6, 3]} intensity={1.1} castShadow />
      <pointLight position={[-3, 2, 2]} intensity={0.35} color={GOLD} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 8]} />
        <meshStandardMaterial color="#0a0a0f" metalness={0.2} roughness={0.85} />
      </mesh>
      {spec.faces.map((sides, i) => {
        const value = spec.values[i];
        const layout = layouts[i];
        if (value == null || !layout) return null;
        const isDropped = spec.droppedMask[i] ?? false;
        return (
          <DieMesh
            key={`${spec.id}-${i}`}
            sides={sides}
            value={value}
            dropped={isDropped}
            index={i}
            layout={layout}
          />
        );
      })}
    </>
  );
}

export function DiceTrayOverlay() {
  const spec = useDiceStore((s) => s.activeAnimation);
  const clearAnimation = useDiceStore((s) => s.clearAnimation);

  useEffect(() => {
    if (!spec) return;
    const t = window.setTimeout(clearAnimation, DURATION * 1000 + TRAY_HOLD_MS);
    return () => window.clearTimeout(t);
  }, [spec, clearAnimation]);

  if (!spec) return null;

  const trayHeight = Math.min(360, 140 + Math.ceil(spec.faces.length / 4) * 44);

  return (
    <div
      className={`fixed inset-0 z-[90] pointer-events-none flex items-end justify-center ${isMobileClient() ? 'pb-40' : 'pb-24'}`}
    >
      <div
        className="rounded-xl overflow-hidden shadow-2xl"
        style={{
          width: Math.min(520, 280 + Math.ceil(spec.faces.length / 4) * 24),
          height: trayHeight,
          background: 'rgba(10,10,15,0.92)',
          border: `1px solid ${GOLD}`,
        }}
      >
        <Canvas
          shadows
          dpr={Math.min(window.devicePixelRatio || 1, 1.5)}
          camera={{ position: [0, 3.2, 5.5], fov: 42 }}
          onCreated={({ gl }) => {
            gl.setClearColor('#0a0a0f', 0);
          }}
        >
          <Suspense fallback={null}>
            <DiceScene spec={spec} />
          </Suspense>
        </Canvas>
      </div>
    </div>
  );
}
