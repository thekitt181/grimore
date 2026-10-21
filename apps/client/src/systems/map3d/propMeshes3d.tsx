import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { canonicalPropId } from '@/systems/map/props/propArt';
import { useMapStore } from '@/systems/map/store/mapStore';
import { resolveDoorSurfaceStyle, type DoorSurfaceStyle } from './doorSurfaceStyles';
import { DoorPanelSurface } from './DoorPanelSurface';
import { doorStyleIsBarred } from './doorPbrAssets';
import { propMaterialProps } from './propMaterialEnhance';

const WOOD = '#6b4423';
const WOOD_DARK = '#3d2412';
const WOOD_LIGHT = '#8b5a2b';
const STONE = '#7a7a82';
const STONE_DARK = '#4a4a52';
const STONE_LIGHT = '#9a9aa4';
const IRON = '#5a5a62';
const IRON_DARK = '#2e2e34';
const GOLD = '#c9a84c';
const BONE = '#e8dcc8';
const BLOOD = '#6b1c1c';
const FLAME = '#ff8a2b';
const FLAME_CORE = '#ffe566';
const WATER = '#3a7ca5';
const MOSS = '#3d6b3d';

function Mat({
  color,
  roughness = 0.78,
  metalness = 0.08,
  emissive,
  emissiveIntensity = 0,
}: {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  return (
    <meshStandardMaterial
      {...propMaterialProps({
        color,
        ...(roughness != null ? { roughness } : {}),
        ...(metalness != null ? { metalness } : {}),
        ...(emissive ? { emissive, emissiveIntensity } : {}),
      })}
    />
  );
}

function Box({
  args,
  position,
  rotation,
  color,
  roughness,
  metalness,
  emissive,
  emissiveIntensity,
}: {
  args: [number, number, number];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  return (
    <mesh
      {...(position ? { position } : {})}
      {...(rotation ? { rotation } : {})}
      castShadow
      receiveShadow
    >
      <boxGeometry args={args} />
      <Mat
        color={color}
        {...(roughness != null ? { roughness } : {})}
        {...(metalness != null ? { metalness } : {})}
        {...(emissive ? { emissive, emissiveIntensity } : {})}
      />
    </mesh>
  );
}

function Cyl({
  args,
  position,
  rotation,
  color,
  roughness,
  metalness,
  emissive,
  emissiveIntensity,
}: {
  args: [number, number, number, number?];
  position?: [number, number, number];
  rotation?: [number, number, number];
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}) {
  const [rTop, rBot, h, seg = 12] = args;
  return (
    <mesh
      {...(position ? { position } : {})}
      {...(rotation ? { rotation } : {})}
      castShadow
      receiveShadow
    >
      <cylinderGeometry args={[rTop, rBot, h, seg]} />
      <Mat
        color={color}
        {...(roughness != null ? { roughness } : {})}
        {...(metalness != null ? { metalness } : {})}
        {...(emissive ? { emissive, emissiveIntensity } : {})}
      />
    </mesh>
  );
}

function FlameFlicker({ y = 0.55, scale = 1 }: { y?: number; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = ref.current;
    if (!m) return;
    const t = clock.elapsedTime;
    const s = scale * (0.85 + Math.sin(t * 9.2) * 0.12 + Math.sin(t * 14.1) * 0.06);
    m.scale.set(s, s * (1.05 + Math.sin(t * 11) * 0.1), s);
    m.position.y = y + Math.sin(t * 7.5) * 0.02 * scale;
  });
  return (
    <mesh ref={ref} position={[0, y, 0]}>
      <coneGeometry args={[0.12 * scale, 0.32 * scale, 7]} />
      <Mat color={FLAME} emissive={FLAME_CORE} emissiveIntensity={1.4} roughness={0.4} />
    </mesh>
  );
}

/** Low-poly stand-in meshes for dungeon props — readable in orbit + first-person. */
export function PropMesh3D({
  propId,
  open = false,
  amount,
  size = 1,
  depth,
  /** World-unit height (doors/gates match extruded wall height). */
  height,
  doorTheme,
  secretConcealed = false,
  doorLongAxisX = true,
}: {
  propId: string;
  open?: boolean;
  /** Smooth 0–1 pose (lid / door / gate). Falls back to open boolean. */
  amount?: number;
  /** Footprint X (world units ≈ map px). */
  size?: number;
  /** Footprint Z (defaults to size). */
  depth?: number;
  height?: number;
  doorTheme?: DoorSurfaceStyle;
  /** Hidden secret door — flush wall (GM ghost), no handle. */
  secretConcealed?: boolean;
  /** Long edge of the door footprint along map X (matches doorCollision alongW). */
  doorLongAxisX?: boolean;
}) {
  const sx = Math.max(size, 8);
  const sz = Math.max(depth ?? size, 8);
  const sy = height != null ? Math.max(height, 8) : Math.max(sx, sz);
  const a = amount ?? (open ? 1 : 0);
  const theme = doorTheme ?? resolveDoorSurfaceStyle('mixed');

  return (
    <group scale={[sx, sy, sz]}>
      <PropBody
        id={propId}
        amount={a}
        doorTheme={theme}
        secretConcealed={secretConcealed}
        worldScaleX={sx}
        worldScaleY={sy}
        doorLongAxisX={doorLongAxisX}
      />
    </group>
  );
}

function PropBody({
  id,
  amount,
  doorTheme,
  secretConcealed,
  worldScaleX,
  worldScaleY,
  doorLongAxisX,
}: {
  id: string;
  amount: number;
  doorTheme: DoorSurfaceStyle;
  secretConcealed: boolean;
  worldScaleX: number;
  worldScaleY: number;
  doorLongAxisX: boolean;
}) {
  switch (id) {
    case 'chest':
    case 'sarcophagus':
      return <Chest amount={amount} fancy={id === 'sarcophagus'} />;
    case 'crate':
      return <Crate />;
    case 'barrel':
    case 'keg':
      return <Barrel tall={id === 'keg'} />;
    case 'column':
      return <Column />;
    case 'torch':
      return <Torch />;
    case 'candle':
      return <Candle />;
    case 'campfire':
      return <Campfire />;
    case 'altar':
      return <Altar lit={amount} />;
    case 'boulder':
      return <Boulder />;
    case 'pedestal':
      return <Pedestal />;
    case 'key':
      return <KeyMesh />;
    case 'statue':
    case 'idol':
    case 'angel':
      return <Statue broken={amount * (id === 'statue' ? 1 : 0)} />;
    case 'door':
    case 'runed-door':
    case 'secret-door':
      return (
        <Door
          amount={amount}
          runed={id === 'runed-door'}
          theme={doorTheme}
          concealed={secretConcealed}
          subtleHandle={id === 'secret-door' && !secretConcealed}
          longAxisX={doorLongAxisX}
          faceWorldW={worldScaleX * 0.88}
          faceWorldH={worldScaleY * 0.98}
          doorStyleId={doorTheme.id}
        />
      );
    case 'gate':
      return <Gate amount={amount} theme={doorTheme} />;
    case 'plate':
      return <Plate amount={amount} />;
    case 'hatch':
      return <Hatch amount={amount} />;
    case 'grate':
      return <Grate />;
    case 'coins':
      return <Coins />;
    case 'skull':
      return <Skull />;
    case 'bone':
    case 'skeleton':
    case 'corpse':
      return <Bones />;
    case 'fountain':
    case 'blood-fountain':
    case 'dry-fountain':
      return <Fountain blood={id === 'blood-fountain'} dry={id === 'dry-fountain' ? 1 - amount : 0} />;
    case 'portal':
      return <Portal />;
    case 'arch':
      return <Arch />;
    case 'ladder':
      return <Ladder />;
    case 'stairs-up':
    case 'stairs-down':
      return <Stairs down={id === 'stairs-down'} sealed={amount} />;
    case 'shop':
      return <Shop closed={amount} />;
    case 'spear':
      return <SpearTrap amount={amount} />;
    case 'blade':
    case 'axe':
      return <BladeTrap amount={amount} />;
    case 'arrows':
    case 'dart':
    case 'bolt':
      return <ArrowTrap amount={amount} />;
    case 'book':
      return <Book amount={amount} />;
    case 'potion':
      return <Potion />;
    case 'sword':
      return <Sword />;
    case 'weapon-rack':
      return <WeaponRack />;
    case 'cage':
      return <Cage />;
    case 'mural':
      return <Mural />;
    case 'art-object':
      return <ArtObject />;
    case 'swarm':
      return <SwarmOverhead />;
    case 'floor-glyph':
      return <FloorGlyph />;
    case 'tripwire':
      return <Tripwire amount={amount} />;
    case 'orb':
      return <Orb />;
    case 'mushroom':
    case 'mold':
      return <Mushroom />;
    case 'ring':
      return <Ring />;
    case 'scroll':
      return <Scroll />;
    case 'bread':
      return <Bread />;
    case 'rune':
    case 'teleport':
    case 'net':
    case 'alarm':
      return <FloorSigil color={id === 'teleport' ? '#6b4cff' : GOLD} />;
    default:
      return <Crate />;
  }
}

function Chest({ amount, fancy }: { amount: number; fancy: boolean }) {
  const bodyH = 0.38;
  const lidH = 0.14;
  const p = amount;
  return (
    <group>
      <Box args={[0.85, bodyH, 0.55]} position={[0, bodyH / 2, 0]} color={fancy ? STONE : WOOD} />
      <Box
        args={[0.88, lidH, 0.58]}
        position={[0, bodyH + lidH / 2 + p * 0.08, -p * 0.22]}
        rotation={[-1.05 * p, 0, 0]}
        color={fancy ? STONE_LIGHT : WOOD_LIGHT}
      />
      <Box args={[0.12, 0.1, 0.04]} position={[0, bodyH * 0.55, 0.28]} color={GOLD} metalness={0.6} roughness={0.35} />
      {p > 0.35 ? (
        <Box
          args={[0.35, 0.08, 0.25]}
          position={[0, bodyH * 0.7, 0]}
          color={GOLD}
          metalness={0.55}
        />
      ) : null}
    </group>
  );
}

function Crate() {
  return (
    <group>
      <Box args={[0.78, 0.72, 0.78]} position={[0, 0.36, 0]} color={WOOD} />
      <Box args={[0.82, 0.08, 0.82]} position={[0, 0.74, 0]} color={WOOD_DARK} />
      <Box args={[0.06, 0.72, 0.82]} position={[-0.36, 0.36, 0]} color={WOOD_DARK} />
      <Box args={[0.06, 0.72, 0.82]} position={[0.36, 0.36, 0]} color={WOOD_DARK} />
    </group>
  );
}

function Barrel({ tall }: { tall?: boolean }) {
  const h = tall ? 0.95 : 0.78;
  const r = tall ? 0.28 : 0.34;
  return (
    <group>
      <Cyl args={[r * 0.92, r, h, 12]} position={[0, h / 2, 0]} color={WOOD} roughness={0.72} />
      <Cyl args={[r * 1.02, r * 1.02, 0.06, 12]} position={[0, h * 0.22, 0]} color={IRON} metalness={0.55} roughness={0.4} />
      <Cyl args={[r * 1.02, r * 1.02, 0.06, 12]} position={[0, h * 0.78, 0]} color={IRON} metalness={0.55} roughness={0.4} />
      <Cyl args={[r * 0.88, r * 0.88, 0.05, 12]} position={[0, h + 0.02, 0]} color={WOOD_DARK} />
    </group>
  );
}

function Candle() {
  return (
    <group>
      <Cyl args={[0.07, 0.08, 0.42, 10]} position={[0, 0.28, 0]} color="#e8e0d0" roughness={0.55} />
      <Cyl args={[0.09, 0.1, 0.08, 10]} position={[0, 0.05, 0]} color={IRON_DARK} metalness={0.4} />
      <FlameFlicker y={0.55} scale={0.55} />
      <pointLight position={[0, 0.62, 0]} color={FLAME} intensity={1.4} distance={3.2} decay={2} />
    </group>
  );
}

function KeyMesh() {
  return (
    <group rotation={[0, 0, -0.35]}>
      <Cyl args={[0.1, 0.1, 0.04, 14]} position={[0, 0.22, 0]} rotation={[Math.PI / 2, 0, 0]} color={GOLD} metalness={0.7} roughness={0.28} />
      <Box args={[0.05, 0.42, 0.05]} position={[0, 0.02, 0]} color={GOLD} metalness={0.65} roughness={0.32} />
      <Box args={[0.14, 0.05, 0.05]} position={[0.05, -0.14, 0]} color={GOLD} metalness={0.65} roughness={0.32} />
      <Box args={[0.1, 0.05, 0.05]} position={[0.03, -0.22, 0]} color={GOLD} metalness={0.65} roughness={0.32} />
    </group>
  );
}

function Column() {
  return (
    <group>
      <Cyl args={[0.28, 0.32, 0.12, 10]} position={[0, 0.06, 0]} color={STONE_DARK} />
      <Cyl args={[0.22, 0.24, 1.35, 10]} position={[0, 0.78, 0]} color={STONE} />
      <Cyl args={[0.3, 0.26, 0.14, 10]} position={[0, 1.52, 0]} color={STONE_LIGHT} />
    </group>
  );
}

function Torch() {
  return (
    <group>
      <Cyl args={[0.05, 0.06, 0.55, 8]} position={[0, 0.35, 0]} color={WOOD_DARK} />
      <Box args={[0.16, 0.12, 0.16]} position={[0, 0.62, 0]} color={IRON} metalness={0.45} />
      <FlameFlicker y={0.78} scale={1.1} />
      <pointLight position={[0, 0.85, 0]} color={FLAME} intensity={2.2} distance={4.5} decay={2} />
    </group>
  );
}

function Campfire() {
  return (
    <group>
      <Box args={[0.5, 0.1, 0.12]} position={[0, 0.08, 0]} rotation={[0, 0.4, 0]} color={WOOD_DARK} />
      <Box args={[0.5, 0.1, 0.12]} position={[0, 0.08, 0]} rotation={[0, -0.7, 0]} color={WOOD} />
      <Box args={[0.45, 0.1, 0.12]} position={[0, 0.14, 0]} rotation={[0, 1.1, 0]} color={WOOD_DARK} />
      <FlameFlicker y={0.42} scale={1.4} />
      <pointLight position={[0, 0.5, 0]} color={FLAME} intensity={3.2} distance={6} decay={2} />
    </group>
  );
}

function Altar({ lit }: { lit: number }) {
  return (
    <group>
      <Box args={[0.9, 0.35, 0.55]} position={[0, 0.18, 0]} color={STONE} />
      <Box args={[1.0, 0.1, 0.65]} position={[0, 0.4, 0]} color={STONE_LIGHT} />
      {lit > 0.04 ? (
        <>
          <FlameFlicker y={0.62} scale={0.9 * (0.5 + lit * 0.5)} />
          <pointLight
            position={[0, 0.7, 0]}
            color={FLAME}
            intensity={1.8 * lit}
            distance={4}
            decay={2}
          />
        </>
      ) : null}
    </group>
  );
}

function Boulder() {
  return (
    <mesh position={[0, 0.28, 0]} castShadow receiveShadow scale={[1, 0.85, 1.1]}>
      <icosahedronGeometry args={[0.38, 0]} />
      <Mat color={STONE_DARK} roughness={0.92} />
    </mesh>
  );
}

function Pedestal() {
  return (
    <group>
      <Cyl args={[0.32, 0.36, 0.12, 10]} position={[0, 0.06, 0]} color={STONE_DARK} />
      <Cyl args={[0.2, 0.22, 0.55, 10]} position={[0, 0.4, 0]} color={STONE} />
      <Cyl args={[0.3, 0.26, 0.1, 10]} position={[0, 0.72, 0]} color={STONE_LIGHT} />
    </group>
  );
}

function Statue({ broken }: { broken: number }) {
  if (broken > 0.55) {
    return <Box args={[0.45, 0.25, 0.45]} position={[0, 0.12, 0]} color={WOOD_DARK} />;
  }
  return (
    <group>
      <Box args={[0.4, 0.15, 0.4]} position={[0, 0.08, 0]} color={STONE_DARK} />
      <Cyl args={[0.14, 0.16, 0.55, 8]} position={[0, 0.45, 0]} color={STONE} />
      <mesh position={[0, 0.85, 0]} castShadow scale={1 - broken * 0.15}>
        <sphereGeometry args={[0.16, 10, 8]} />
        <Mat color={STONE_LIGHT} />
      </mesh>
    </group>
  );
}

function Door({
  amount,
  runed,
  theme,
  concealed,
  subtleHandle,
  longAxisX,
  faceWorldW,
  faceWorldH,
  doorStyleId,
}: {
  amount: number;
  runed: boolean;
  theme: DoorSurfaceStyle;
  concealed: boolean;
  subtleHandle: boolean;
  /** False when item.height > item.width — panel needs an extra quarter-turn. */
  longAxisX: boolean;
  faceWorldW: number;
  faceWorldH: number;
  doorStyleId: string;
}) {
  // Unit cube: Y 0→1 matches wall height after PropMesh3D Y scale.
  // Panel plane defaults to +Z; one Y-turn aligns with map X when width is the long edge.
  // Hidden secrets: no 3D panel — extruded wall + invisible pick only (slab was edge-on / fin glitch).
  if (concealed) {
    return null;
  }

  const handleColor = theme.handle;
  const handleScale = subtleHandle ? 0.55 : 1;
  const gridSize = useMapStore((s) => s.gridSize);
  const tileWorld = Math.max(72, (gridSize || 96) * 3.2);
  const barred = doorStyleIsBarred(doorStyleId);
  // Footprint width → map X, height → depth (Z). Swing on hinge edge so panel + handles stay glued.
  const halfW = 0.44;
  const openAngle = amount * (Math.PI / 2);
  const hinge: [number, number, number] = longAxisX
    ? [-halfW, 0.5, 0.04]
    : [0.04, 0.5, -halfW];
  const panelCenterOffset: [number, number, number] = longAxisX
    ? [halfW, 0, 0]
    : [0, 0, halfW];
  const panelRotY = longAxisX ? 0 : Math.PI / 2;
  // Panel-local: plane XY, faces ±Z — one handle per side, latch stile at +X.
  const latchX = 0.34;
  const latchY = -0.02;
  const faceZ = subtleHandle ? 0.042 : 0.048;

  return (
    <group>
      <group position={hinge}>
        <group rotation={[0, openAngle, 0]}>
          <group position={panelCenterOffset} rotation={[0, panelRotY, 0]}>
          <mesh castShadow receiveShadow renderOrder={4}>
            <DoorPanelSurface
              doorStyleId={doorStyleId}
              faceUnitW={0.88}
              faceUnitH={0.98}
              faceWorldW={faceWorldW}
              faceWorldH={faceWorldH}
              tileWorld={tileWorld}
            />
          </mesh>
          {barred && <BarredDoorOverlay theme={theme} longAxisX={longAxisX} />}
          {!subtleHandle && (
            <>
              <Box
                args={[0.04 * handleScale, 0.07 * handleScale, 0.07 * handleScale]}
                position={[latchX, latchY, faceZ]}
                color={handleColor}
                metalness={0.5}
              />
              <Box
                args={[0.04 * handleScale, 0.07 * handleScale, 0.07 * handleScale]}
                position={[latchX, latchY, -faceZ]}
                color={handleColor}
                metalness={0.5}
              />
            </>
          )}
          {subtleHandle && (
            <>
              <Box
                args={[0.025, 0.05, 0.05]}
                position={[latchX, latchY - 0.02, faceZ]}
                color={handleColor}
                metalness={0.45}
              />
              <Box
                args={[0.025, 0.05, 0.05]}
                position={[latchX, latchY - 0.02, -faceZ]}
                color={handleColor}
                metalness={0.45}
              />
            </>
          )}
          {runed && (
            <Box
              args={[0.02, 0.3, 0.3]}
              position={[latchX - 0.28, 0.12, 0]}
              color={theme.rune}
              emissive={theme.rune}
              emissiveIntensity={0.4}
            />
          )}
          </group>
        </group>
      </group>
    </group>
  );
}

function BarredDoorOverlay({ theme, longAxisX }: { theme: DoorSurfaceStyle; longAxisX: boolean }) {
  const bars = [-0.34, -0.17, 0, 0.17, 0.34];
  return (
    <group
      position={longAxisX ? [0.058, 0, 0] : [0, 0, 0.058]}
      rotation={[0, longAxisX ? Math.PI / 2 : 0, 0]}
    >
      {bars.map((z) => (
        <Box
          key={z}
          args={[0.045, 0.9, 0.045]}
          position={[0, 0, z]}
          color={theme.trim}
          metalness={0.55}
          roughness={0.38}
        />
      ))}
      <Box args={[0.04, 0.08, 0.82]} position={[0, 0.42, 0]} color={theme.gateDark} metalness={0.45} />
      <Box args={[0.04, 0.08, 0.82]} position={[0, -0.42, 0]} color={theme.gateDark} metalness={0.45} />
    </group>
  );
}

function Gate({ amount, theme }: { amount: number; theme: DoorSurfaceStyle }) {
  // Bars only — gaps are empty air (see-through). Y 0→1 matches wall height.
  // Open lifts the grate into the arch so the passage is clear, but keep the
  // mesh so players still see the raised portcullis (never unmount when open).
  const lift = amount * 1.05;
  const bars = [-0.38, -0.19, 0, 0.19, 0.38];
  return (
    <group position={[0, lift, 0]}>
      {bars.map((x) => (
        <Box
          key={x}
          args={[0.055, 0.98, 0.055]}
          position={[x, 0.5, 0]}
          color={theme.gate}
          metalness={0.55}
          roughness={0.4}
        />
      ))}
      <Box args={[0.86, 0.05, 0.05]} position={[0, 0.22, 0]} color={theme.gateDark} metalness={0.5} />
      <Box args={[0.86, 0.05, 0.05]} position={[0, 0.5, 0]} color={theme.gateDark} metalness={0.5} />
      <Box args={[0.86, 0.05, 0.05]} position={[0, 0.78, 0]} color={theme.gateDark} metalness={0.5} />
      {/* Spikes along the bottom edge */}
      {bars.map((x) => (
        <Box
          key={`s${x}`}
          args={[0.04, 0.08, 0.04]}
          position={[x, 0.04, 0]}
          color={IRON_DARK}
          metalness={0.55}
        />
      ))}
    </group>
  );
}

function Plate({ amount }: { amount: number }) {
  const h = 0.08 - amount * 0.04;
  return (
    <Box
      args={[0.7, h, 0.7]}
      position={[0, h / 2, 0]}
      color={STONE}
    />
  );
}

function Hatch({ amount }: { amount: number }) {
  return (
    <group>
      <Box args={[0.85, 0.06, 0.85]} position={[0, 0.03, 0]} color={WOOD_DARK} />
      {amount > 0.15 ? (
        <Box args={[0.55, 0.02, 0.55]} position={[0, -0.01, 0]} color={IRON_DARK} />
      ) : null}
      <group scale={[Math.max(0.05, 1 - amount * 0.92), 1, 1]}>
        <Box args={[0.7, 0.05, 0.7]} position={[0, 0.08, 0]} color={WOOD} />
      </group>
    </group>
  );
}

function Grate() {
  return (
    <group>
      <Box args={[0.85, 0.04, 0.85]} position={[0, 0.02, 0]} color={IRON_DARK} metalness={0.5} />
      {[-0.25, 0, 0.25].map((x) => (
        <Box key={`x${x}`} args={[0.06, 0.05, 0.8]} position={[x, 0.04, 0]} color={IRON} metalness={0.55} />
      ))}
      {[-0.25, 0, 0.25].map((z) => (
        <Box key={`z${z}`} args={[0.8, 0.05, 0.06]} position={[0, 0.04, z]} color={IRON} metalness={0.55} />
      ))}
    </group>
  );
}

function Coins() {
  return (
    <group>
      {[
        [0, 0.04, 0],
        [0.12, 0.05, 0.08],
        [-0.1, 0.05, 0.06],
        [0.05, 0.08, -0.1],
        [-0.08, 0.07, -0.08],
      ].map(([x, y, z], i) => (
        <Cyl
          key={i}
          args={[0.09, 0.09, 0.03, 10]}
          position={[x!, y!, z!]}
          color={GOLD}
          metalness={0.7}
          roughness={0.3}
        />
      ))}
    </group>
  );
}

function Skull() {
  return (
    <group>
      <mesh position={[0, 0.18, 0]} castShadow>
        <sphereGeometry args={[0.18, 10, 8]} />
        <Mat color={BONE} roughness={0.85} />
      </mesh>
      <Box args={[0.06, 0.04, 0.04]} position={[-0.07, 0.2, 0.14]} color={IRON_DARK} />
      <Box args={[0.06, 0.04, 0.04]} position={[0.07, 0.2, 0.14]} color={IRON_DARK} />
    </group>
  );
}

function Bones() {
  return (
    <group>
      <Box args={[0.55, 0.08, 0.12]} position={[0, 0.06, 0]} rotation={[0, 0.3, 0.2]} color={BONE} />
      <Box args={[0.45, 0.07, 0.1]} position={[0.05, 0.1, 0.1]} rotation={[0.2, -0.5, 0]} color={BONE} />
      <mesh position={[-0.15, 0.14, -0.05]} castShadow>
        <sphereGeometry args={[0.1, 8, 6]} />
        <Mat color={BONE} />
      </mesh>
    </group>
  );
}

function Fountain({ blood, dry }: { blood: boolean; dry: number }) {
  const wet = 1 - dry;
  return (
    <group>
      <Cyl args={[0.42, 0.45, 0.2, 12]} position={[0, 0.1, 0]} color={STONE} />
      <Cyl args={[0.14, 0.16, 0.55, 10]} position={[0, 0.45, 0]} color={STONE_LIGHT} />
      {wet > 0.04 ? (
        <Cyl
          args={[0.28 * wet, 0.28 * wet, 0.08, 12]}
          position={[0, 0.22, 0]}
          color={blood ? BLOOD : WATER}
          roughness={0.25}
          metalness={0.15}
          emissive={blood ? BLOOD : WATER}
          emissiveIntensity={0.2 * wet}
        />
      ) : null}
    </group>
  );
}

function Portal() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (ref.current) {
      const m = ref.current.material as THREE.MeshStandardMaterial;
      m.emissiveIntensity = 0.55 + Math.sin(clock.elapsedTime * 2.4) * 0.25;
    }
  });
  return (
    <group>
      <Cyl args={[0.48, 0.48, 0.1, 16]} position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]} color={IRON_DARK} metalness={0.4} />
      <mesh ref={ref} position={[0, 0.55, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.38, 20]} />
        <Mat color="#5b3dff" emissive="#9b7dff" emissiveIntensity={0.7} roughness={0.35} />
      </mesh>
    </group>
  );
}

function Arch() {
  return (
    <group>
      <Box args={[0.22, 1.2, 0.28]} position={[-0.4, 0.6, 0]} color={STONE} />
      <Box args={[0.22, 1.2, 0.28]} position={[0.4, 0.6, 0]} color={STONE} />
      <Box args={[1.05, 0.22, 0.3]} position={[0, 1.25, 0]} color={STONE_LIGHT} />
    </group>
  );
}

function Ladder() {
  return (
    <group rotation={[0.15, 0, 0]}>
      <Box args={[0.06, 1.3, 0.06]} position={[-0.18, 0.65, 0]} color={WOOD} />
      <Box args={[0.06, 1.3, 0.06]} position={[0.18, 0.65, 0]} color={WOOD} />
      {[0.2, 0.45, 0.7, 0.95, 1.15].map((y) => (
        <Box key={y} args={[0.4, 0.05, 0.06]} position={[0, y, 0]} color={WOOD_LIGHT} />
      ))}
    </group>
  );
}

function Stairs({ down, sealed }: { down: boolean; sealed: number }) {
  if (sealed > 0.55) {
    return <Box args={[0.9, 0.12, 0.9]} position={[0, 0.06, 0]} color={STONE_DARK} />;
  }
  return (
    <group rotation={[0, down ? Math.PI : 0, 0]}>
      {[0, 1, 2, 3].map((i) => (
        <Box
          key={i}
          args={[0.85, 0.12, 0.22]}
          position={[0, 0.06 + i * 0.12, -0.3 + i * 0.2]}
          color={i % 2 ? STONE : STONE_LIGHT}
        />
      ))}
    </group>
  );
}

function Shop({ closed }: { closed: number }) {
  return (
    <group>
      <Box args={[0.95, 0.7, 0.55]} position={[0, 0.35, 0]} color={WOOD} />
      <Box args={[1.0, 0.08, 0.6]} position={[0, 0.74, 0]} color={WOOD_DARK} />
      {closed < 0.5 ? (
        <Box args={[0.5, 0.35, 0.08]} position={[0, 0.4, 0.28]} color={WOOD_LIGHT} />
      ) : (
        <Box args={[0.7, 0.45, 0.06]} position={[0, 0.4, 0.3]} color={IRON_DARK} metalness={0.4} />
      )}
    </group>
  );
}

function SpearTrap({ amount }: { amount: number }) {
  const h = 0.18 + amount * 1.05;
  return (
    <group>
      <Box args={[0.78, 0.07, 0.78]} position={[0, 0.035, 0]} color={STONE_DARK} />
      {[-0.22, -0.07, 0.07, 0.22].map((x) => (
        <group key={x}>
          <Cyl
            args={[0.035, 0.022, h, 7]}
            position={[x, h / 2 + 0.02, 0]}
            color={IRON}
            metalness={0.62}
            roughness={0.28}
          />
          <mesh position={[x, h + 0.04, 0]}>
            <coneGeometry args={[0.045, 0.12, 7]} />
            <Mat color={IRON} metalness={0.7} roughness={0.22} emissive={amount > 0.2 ? GOLD : undefined} emissiveIntensity={amount > 0.2 ? 0.25 : 0} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function BladeTrap({ amount }: { amount: number }) {
  const swing = amount * 1.15;
  return (
    <group>
      <Box args={[0.7, 0.09, 0.7]} position={[0, 0.045, 0]} color={IRON_DARK} metalness={0.45} />
      <group position={[0, 0.1, 0]} rotation={[0, 0, -0.15 + swing * 1.35]}>
        <Box
          args={[0.72, 0.045, 0.1]}
          position={[0.2 * swing, 0.08 + swing * 0.15, 0]}
          color={IRON}
          metalness={0.72}
          roughness={0.22}
        />
        <Box
          args={[0.12, 0.08, 0.12]}
          position={[-0.28, 0.06, 0]}
          color={GOLD}
          metalness={0.55}
          roughness={0.35}
        />
      </group>
    </group>
  );
}

function ArrowTrap({ amount }: { amount: number }) {
  const primed = amount > 0.02;
  return (
    <group>
      <Box args={[0.58, 0.38, 0.4]} position={[0, 0.2, 0]} color={STONE} />
      <Box args={[0.5, 0.28, 0.08]} position={[0, 0.22, 0.18]} color={STONE_DARK} />
      {[-0.14, 0, 0.14].map((x) => (
        <Cyl
          key={x}
          args={[0.045, 0.045, 0.32, 8]}
          position={[x, 0.22, 0.28]}
          rotation={[Math.PI / 2, 0, 0]}
          color={IRON_DARK}
          metalness={0.55}
        />
      ))}
      {primed
        ? [-0.14, 0, 0.14].map((x) => (
            <mesh key={`tip${x}`} position={[x, 0.22, 0.42]} rotation={[Math.PI / 2, 0, 0]}>
              <coneGeometry args={[0.03, 0.14, 6]} />
              <Mat color={IRON} metalness={0.7} roughness={0.25} emissive={GOLD} emissiveIntensity={0.35} />
            </mesh>
          ))
        : null}
    </group>
  );
}

function Book({ amount }: { amount: number }) {
  return (
    <group>
      <Box args={[0.35, 0.08, 0.28]} position={[0, 0.05, 0]} color={BLOOD} />
      <Box
        args={[0.16, 0.02, 0.26]}
        position={[-0.1 * amount, 0.1, 0]}
        rotation={[0, 0, -0.3 * amount]}
        color="#f4efe4"
      />
      <Box
        args={[0.16, 0.02, 0.26]}
        position={[0.1 * amount, 0.1, 0]}
        rotation={[0, 0, 0.3 * amount]}
        color="#f4efe4"
      />
      {amount < 0.5 ? (
        <Box args={[0.32, 0.03, 0.25]} position={[0, 0.1, 0]} color={GOLD} metalness={0.4} />
      ) : null}
    </group>
  );
}

function Potion() {
  return (
    <group>
      <Cyl args={[0.08, 0.1, 0.22, 10]} position={[0, 0.14, 0]} color="#2a6b4a" roughness={0.35} />
      <Cyl args={[0.04, 0.05, 0.1, 8]} position={[0, 0.3, 0]} color="#2a6b4a" roughness={0.35} />
      <mesh position={[0, 0.14, 0]}>
        <sphereGeometry args={[0.07, 10, 8]} />
        <Mat color="#4ade80" emissive="#22c55e" emissiveIntensity={0.35} roughness={0.3} />
      </mesh>
    </group>
  );
}

function Sword() {
  return (
    <group rotation={[0, 0, 0.4]}>
      <Box args={[0.06, 0.55, 0.02]} position={[0, 0.35, 0]} color={IRON} metalness={0.7} roughness={0.25} />
      <Box args={[0.18, 0.04, 0.04]} position={[0, 0.12, 0]} color={GOLD} metalness={0.5} />
      <Box args={[0.05, 0.14, 0.05]} position={[0, 0.04, 0]} color={WOOD_DARK} />
    </group>
  );
}

function Cage() {
  const bars = [-0.28, -0.14, 0, 0.14, 0.28];
  return (
    <group>
      <Box args={[0.62, 0.05, 0.62]} position={[0, 0.025, 0]} color={WOOD_DARK} />
      {bars.map((x) => (
        <Box key={`bx${x}`} args={[0.04, 0.52, 0.04]} position={[x, 0.29, 0.26]} color={IRON} metalness={0.55} />
      ))}
      {bars.map((z) => (
        <Box key={`bz${z}`} args={[0.04, 0.52, 0.04]} position={[0.28, 0.29, z]} color={IRON} metalness={0.55} />
      ))}
      <Box args={[0.04, 0.52, 0.58]} position={[-0.28, 0.29, 0]} color={IRON_DARK} metalness={0.5} />
      <Box args={[0.58, 0.04, 0.04]} position={[0, 0.52, 0.28]} color={IRON_DARK} metalness={0.5} />
    </group>
  );
}

function Mural() {
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <Box args={[0.06, 0.72, 0.82]} position={[0, 0.38, 0]} color={WOOD_DARK} />
      <mesh position={[0.04, 0.4, 0]} castShadow>
        <planeGeometry args={[0.72, 0.62]} />
        <Mat color={STONE_LIGHT} roughness={0.92} />
      </mesh>
      <mesh position={[0.045, 0.44, 0.02]}>
        <planeGeometry args={[0.5, 0.38]} />
        <Mat color="#8a8075" roughness={0.95} />
      </mesh>
      <mesh position={[0.046, 0.48, 0.03]}>
        <ringGeometry args={[0.08, 0.14, 12]} />
        <Mat color={GOLD} emissive={GOLD} emissiveIntensity={0.12} roughness={0.55} metalness={0.35} />
      </mesh>
    </group>
  );
}

function ArtObject() {
  return (
    <group>
      <Box args={[0.22, 0.08, 0.22]} position={[0, 0.04, 0]} color={WOOD_DARK} />
      <Box args={[0.16, 0.06, 0.16]} position={[0, 0.1, 0]} color={STONE_DARK} />
      <mesh position={[0, 0.28, 0]} castShadow>
        <sphereGeometry args={[0.12, 14, 10]} />
        <Mat color={GOLD} emissive={FLAME_CORE} emissiveIntensity={0.18} metalness={0.55} roughness={0.32} />
      </mesh>
    </group>
  );
}

function SwarmOverhead() {
  const g = useRef<THREE.Group>(null);
  const bugs = useRef(
    Array.from({ length: 9 }, (_, i) => ({
      phase: i * 0.7,
      base: [
        [-0.22, 0.72, 0.08],
        [0.1, 0.78, -0.06],
        [0.24, 0.7, 0.12],
        [-0.08, 0.68, -0.14],
        [0.18, 0.74, 0.02],
        [-0.28, 0.76, -0.04],
        [0.02, 0.8, 0.16],
        [-0.16, 0.69, 0.18],
        [0.28, 0.73, -0.1],
      ][i]!,
    })),
  );
  useFrame(({ clock }) => {
    const root = g.current;
    if (!root) return;
    const t = clock.elapsedTime;
    root.children.forEach((child, i) => {
      const b = bugs.current[i];
      if (!b) return;
      const flutter = Math.sin(t * 8 + b.phase) * 0.04;
      child.position.set(b.base[0]! + flutter, b.base[1]! + Math.sin(t * 5 + b.phase) * 0.03, b.base[2]!);
      child.rotation.y = t * 2 + b.phase;
    });
  });
  return (
    <group ref={g}>
      {bugs.current.map((b, i) => (
        <mesh key={i} position={b.base as [number, number, number]} scale={[1.2, 0.35, 1.6]}>
          <sphereGeometry args={[0.05, 6, 4]} />
          <Mat color="#1a1814" emissive="#2a2520" emissiveIntensity={0.15} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function FloorGlyph() {
  const ring = useRef<THREE.Mesh>(null);
  const star = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const pulse = 0.35 + Math.sin(t * 2.4) * 0.22;
    if (ring.current?.material && 'emissiveIntensity' in ring.current.material) {
      (ring.current.material as THREE.MeshStandardMaterial).emissiveIntensity = pulse;
    }
    if (star.current) {
      star.current.rotation.z = t * 0.35;
    }
  });
  return (
    <group>
      <mesh ref={ring} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.22, 0.38, 24]} />
        <Mat color="#6b4cff" emissive="#9b7dff" emissiveIntensity={0.45} roughness={0.42} />
      </mesh>
      <mesh ref={star} position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.18, 8]} />
        <Mat color="#4a38cc" emissive="#6b4cff" emissiveIntensity={0.35} roughness={0.5} />
      </mesh>
    </group>
  );
}

function Tripwire({ amount }: { amount: number }) {
  const slack = amount * 0.08;
  return (
    <group>
      <Box args={[0.06, 0.12, 0.06]} position={[-0.32, 0.06, 0.22]} color={STONE_DARK} />
      <Box args={[0.06, 0.12, 0.06]} position={[0.32, 0.06, -0.22]} color={STONE_DARK} />
      <mesh position={[0, 0.08 - slack, 0]} rotation={[0.35 + amount * 0.2, 0, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.78, 6]} />
        <Mat color="#8a8075" roughness={0.9} />
      </mesh>
    </group>
  );
}

function WeaponRack() {
  const blades: Array<[number, number, number]> = [
    [-0.22, 0.42, 0.05],
    [0, 0.48, -0.02],
    [0.22, 0.4, 0.04],
    [-0.12, 0.28, -0.06],
    [0.14, 0.3, 0.08],
  ];
  return (
    <group>
      <Box args={[0.82, 0.06, 0.28]} position={[0, 0.03, 0]} color={WOOD_DARK} />
      <Box args={[0.78, 0.52, 0.06]} position={[0, 0.32, -0.08]} color={WOOD} roughness={0.82} />
      <Box args={[0.78, 0.04, 0.08]} position={[0, 0.22, -0.05]} color={WOOD_LIGHT} />
      <Box args={[0.78, 0.04, 0.08]} position={[0, 0.38, -0.05]} color={WOOD_LIGHT} />
      {blades.map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]} rotation={[0, 0, 0.15 + i * 0.08]}>
          <Box args={[0.04, 0.32, 0.015]} position={[0, 0, 0]} color={IRON} metalness={0.65} roughness={0.28} />
          <Box args={[0.1, 0.025, 0.025]} position={[0, -0.14, 0]} color={GOLD} metalness={0.45} />
        </group>
      ))}
    </group>
  );
}

function Orb() {
  return (
    <mesh position={[0, 0.22, 0]} castShadow>
      <sphereGeometry args={[0.2, 16, 12]} />
      <Mat color="#6b4cff" emissive="#9b7dff" emissiveIntensity={0.55} roughness={0.25} metalness={0.2} />
    </mesh>
  );
}

function Mushroom() {
  return (
    <group>
      <Cyl args={[0.06, 0.08, 0.22, 8]} position={[0, 0.12, 0]} color={BONE} />
      <mesh position={[0, 0.28, 0]} castShadow scale={[1, 0.55, 1]}>
        <sphereGeometry args={[0.2, 10, 8]} />
        <Mat color={MOSS} />
      </mesh>
    </group>
  );
}

function Ring() {
  return (
    <mesh position={[0, 0.06, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[0.12, 0.03, 8, 16]} />
      <Mat color={GOLD} metalness={0.75} roughness={0.28} />
    </mesh>
  );
}

function Scroll() {
  return (
    <group>
      <Cyl args={[0.07, 0.07, 0.4, 10]} position={[0, 0.07, 0]} rotation={[0, 0, Math.PI / 2]} color="#e8dcc8" />
      <Cyl args={[0.08, 0.08, 0.05, 10]} position={[-0.2, 0.07, 0]} rotation={[0, 0, Math.PI / 2]} color={WOOD} />
      <Cyl args={[0.08, 0.08, 0.05, 10]} position={[0.2, 0.07, 0]} rotation={[0, 0, Math.PI / 2]} color={WOOD} />
    </group>
  );
}

function Bread() {
  return (
    <mesh position={[0, 0.08, 0]} scale={[1.2, 0.55, 0.8]} castShadow>
      <sphereGeometry args={[0.16, 10, 8]} />
      <Mat color="#c4a574" roughness={0.9} />
    </mesh>
  );
}

function FloorSigil({ color }: { color: string }) {
  return (
    <mesh position={[0, 0.03, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.18, 0.38, 20]} />
      <Mat color={color} emissive={color} emissiveIntensity={0.45} roughness={0.4} />
    </mesh>
  );
}

/** Procedural mesh catalog — must match `PropBody` switch cases. */
const PROCEDURAL_MESH_PROP_IDS = new Set<string>([
  'chest',
  'sarcophagus',
  'crate',
  'barrel',
  'keg',
  'column',
  'torch',
  'candle',
  'campfire',
  'altar',
  'boulder',
  'pedestal',
  'key',
  'statue',
  'idol',
  'angel',
  'door',
  'runed-door',
  'secret-door',
  'gate',
  'plate',
  'hatch',
  'grate',
  'coins',
  'skull',
  'bone',
  'skeleton',
  'corpse',
  'fountain',
  'blood-fountain',
  'dry-fountain',
  'portal',
  'arch',
  'ladder',
  'stairs-up',
  'stairs-down',
  'shop',
  'spear',
  'blade',
  'axe',
  'arrows',
  'dart',
  'bolt',
  'book',
  'potion',
  'sword',
  'weapon-rack',
  'cage',
  'mural',
  'art-object',
  'swarm',
  'floor-glyph',
  'tripwire',
  'orb',
  'mushroom',
  'mold',
  'ring',
  'scroll',
  'bread',
  'rune',
  'teleport',
  'net',
  'alarm',
]);

/** True when we have a dedicated procedural mesh for this prop id (incl. canvas-art props). */
export function hasPropMesh3D(propId: string | undefined): boolean {
  if (!propId) return false;
  return PROCEDURAL_MESH_PROP_IDS.has(canonicalPropId(propId));
}
