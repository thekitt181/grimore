import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import * as THREE from 'three';
import { isMobileClient } from '@/lib/socket';
import { useDiceStore, type DiceAnimationSpec } from './diceStore';
import { buildNumberedDie, normalizeDieSides } from './dieGeometry';
import {
  buildNumberedDieTextureCanvas,
  buildDieRoughnessCanvas,
  useDiceSkinStore,
  type DieCellLabel,
} from './diceSkinStore';

/**
 * Cache of built die textures keyed by image + fit. Dice in a roll usually share
 * the same skin, so this builds the high-res texture once and reuses it across
 * every die and every roll (textures are long-lived, so they are not disposed
 * per-die; the cache is bounded to avoid unbounded growth).
 */
interface DieTextureSet {
  map: THREE.Texture;
  rough: THREE.Texture;
}

const textureCache = new Map<string, DieTextureSet>();
const TEXTURE_CACHE_LIMIT = 24;
/** Roughness map (shared glitter sparkle) is identical for every die — built once. */
let sharedRough: THREE.Texture | null = null;

interface NumberedTextureRequest {
  image: string | null;
  bodyColor: string;
  fit: number;
  kind: number;
  cols: number;
  rows: number;
  cellLabels: DieCellLabel[][];
}

function finalizeTexture(canvas: HTMLCanvasElement, srgb: boolean): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 16;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

function getRoughTexture(): THREE.Texture {
  if (!sharedRough) sharedRough = finalizeTexture(buildDieRoughnessCanvas(1024), false);
  return sharedRough;
}

function cacheTexture(key: string, set: DieTextureSet): void {
  if (textureCache.size >= TEXTURE_CACHE_LIMIT) {
    const oldestKey = textureCache.keys().next().value;
    if (oldestKey !== undefined) {
      textureCache.get(oldestKey)?.map.dispose();
      textureCache.delete(oldestKey);
    }
  }
  textureCache.set(key, set);
}

function getNumberedTexture(req: NumberedTextureRequest): Promise<DieTextureSet> {
  const key = `${req.fit.toFixed(3)}|d${req.kind}|${req.bodyColor}|${req.image ?? 'none'}`;
  const cached = textureCache.get(key);
  if (cached) return Promise.resolve(cached);

  const build = (img: HTMLImageElement | null): DieTextureSet => {
    const canvas = buildNumberedDieTextureCanvas({
      img,
      bodyColor: req.bodyColor,
      zoom: req.fit,
      cols: req.cols,
      rows: req.rows,
      cellLabels: req.cellLabels,
    });
    const set: DieTextureSet = {
      map: finalizeTexture(canvas, true),
      rough: getRoughTexture(),
    };
    cacheTexture(key, set);
    return set;
  };

  if (!req.image) return Promise.resolve(build(null));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(build(img));
    img.onerror = () => resolve(build(null));
    img.src = req.image as string;
  });
}

/** Resolve a cached numbered-face texture set (albedo + glitter roughness map). */
function useNumberedTexture(req: NumberedTextureRequest): DieTextureSet | null {
  const [textures, setTextures] = useState<DieTextureSet | null>(null);
  const { image, bodyColor, fit, kind, cols, rows, cellLabels } = req;
  useEffect(() => {
    let cancelled = false;
    getNumberedTexture({ image, bodyColor, fit, kind, cols, rows, cellLabels })
      .then((set) => {
        if (!cancelled) setTextures(set);
      })
      .catch(() => {
        if (!cancelled) setTextures(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, bodyColor, fit, kind]);
  return textures;
}

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
  const die = useMemo(() => buildNumberedDie(sides), [sides]);
  const { x, z, scale } = layout;
  const skin = useDiceSkinStore((s) => s.skinFor(sides));
  const imageFit = useDiceSkinStore((s) => s.imageFit);

  const texture = useNumberedTexture({
    image: dropped ? null : skin.image,
    bodyColor: dropped ? '#3f3f46' : skin.color,
    fit: imageFit,
    kind,
    cols: die.cols,
    rows: die.rows,
    cellLabels: die.cellLabels as DieCellLabel[][],
  });

  // Orientation that shows the rolled value upright toward the camera (d6–d20: its
  // face; d4: its winning vertex pointed up so the apex reads the result).
  const restQuat = useMemo(() => die.orientFor(value), [value, die]);

  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const elapsed = (performance.now() - start.current) / 1000;
    const t = Math.min(1, elapsed / DURATION);

    if (t < 0.82) {
      const ease = 1 - Math.pow(1 - t / 0.82, 3);
      mesh.rotation.x = ease * (Math.PI * 4 + value * 0.31);
      mesh.rotation.y = ease * (Math.PI * 3 + index * 0.7);
      mesh.rotation.z = ease * (Math.PI * 2 + kind * 0.08);
      mesh.position.y = 0.4 + Math.sin((t / 0.82) * Math.PI) * 1.1;
    } else {
      // Settle: ease into the orientation that shows the result face.
      mesh.quaternion.slerp(restQuat, 0.18);
      mesh.position.y += (0.35 - mesh.position.y) * 0.2;
    }
  });

  return (
    <mesh ref={ref} geometry={die.geometry} position={[x, 0.35, z]} scale={scale} castShadow>
      {texture ? (
        // Scanned colour/pattern as a true PBR albedo so it responds to light and
        // catches highlights. A glossy clearcoat gives the polished resin sheen, and
        // the glitter roughness map makes individual flecks twinkle as the die rolls.
        // A faint emissive keeps the colour rich in shadow without washing out.
        <meshPhysicalMaterial
          map={texture.map}
          roughnessMap={texture.rough}
          roughness={1}
          metalness={0}
          emissive="#ffffff"
          emissiveMap={texture.map}
          emissiveIntensity={dropped ? 0.08 : 0.15}
          clearcoat={0.7}
          clearcoatRoughness={0.32}
          envMapIntensity={0.45}
          sheen={0.4}
          sheenColor="#ffffff"
          transparent={dropped}
          opacity={dropped ? 0.55 : 1}
        />
      ) : (
        <meshStandardMaterial color={dropped ? '#3f3f46' : skin.color} roughness={0.4} metalness={0} />
      )}
    </mesh>
  );
}

function TrayCamera({ diceCount }: { diceCount: number }) {
  const { camera } = useThree();
  const cols = layoutColumns(diceCount);
  const rows = Math.ceil(diceCount / cols);
  // Closer camera = larger, sharper dice (more rendered pixels each).
  const camY = 2.5 + Math.max(0, rows - 2) * 0.5;
  const camZ = 4.2 + Math.max(0, rows - 2) * 0.4;

  useEffect(() => {
    camera.position.set(0, camY, camZ);
    camera.lookAt(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = diceCount > 9 ? 46 : 38;
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
      <ambientLight intensity={0.45} />
      <directionalLight position={[4, 6, 3]} intensity={0.95} castShadow />
      <directionalLight position={[-5, 3, -2]} intensity={0.45} color="#bcd4ff" />
      <pointLight position={[-3, 2, 2]} intensity={0.35} color={GOLD} />
      {/* Procedural studio environment (no network) — kept dim so it provides
          glossy reflections without washing the diffuse surface to white. */}
      <Environment resolution={256} frames={1}>
        {/* Large, soft, overlapping panels = gentle wrap-around sheen rather than a
            hard rectangular reflection streak on the flat d6 faces. */}
        <Lightformer intensity={0.45} color="#fff6e6" position={[0, 5, 3]} scale={[12, 8, 1]} />
        <Lightformer
          intensity={0.3}
          color="#ffe1b0"
          position={[-5, 2, 1]}
          rotation-y={Math.PI / 4}
          scale={[8, 8, 1]}
        />
        <Lightformer
          intensity={0.28}
          color={GOLD}
          position={[5, 1, 1]}
          rotation-y={-Math.PI / 4}
          scale={[8, 8, 1]}
        />
        <Lightformer intensity={0.2} color="#bcd4ff" position={[0, -4, 1]} scale={[10, 6, 1]} />
      </Environment>
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

  const trayHeight = Math.min(560, 300 + Math.ceil(spec.faces.length / 4) * 48);

  return (
    <div
      className={`fixed inset-0 z-[90] pointer-events-none flex items-end justify-center ${isMobileClient() ? 'pb-40' : 'pb-24'}`}
    >
      <div
        className="rounded-xl overflow-hidden shadow-2xl"
        style={{
          width: Math.min(760, 440 + Math.ceil(spec.faces.length / 4) * 26),
          height: trayHeight,
          background: 'rgba(10,10,15,0.92)',
          border: `1px solid ${GOLD}`,
        }}
      >
        <Canvas
          shadows
          gl={{ antialias: true }}
          dpr={Math.min(window.devicePixelRatio || 1, 2.5)}
          camera={{ position: [0, 2.5, 4.2], fov: 38 }}
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
