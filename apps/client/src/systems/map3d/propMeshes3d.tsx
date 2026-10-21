import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

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
      color={color}
      roughness={roughness}
      metalness={metalness}
      {...(emissive ? { emissive, emissiveIntensity } : {})}
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
  /** World-unit height (doors/gates match extruded wall height). */
  height,
}: {
  propId: string;
  open?: boolean;
  /** Smooth 0–1 pose (lid / door / gate). Falls back to open boolean. */
  amount?: number;
  /** Footprint scale (world units ≈ map cell). */
  size?: number;
  height?: number;
}) {
  const sx = Math.max(size, 8);
  const sy = height != null ? Math.max(height, 8) : sx;
  const a = amount ?? (open ? 1 : 0);

  return (
    <group scale={[sx, sy, sx]}>
      <PropBody id={propId} amount={a} />
    </group>
  );
}

function PropBody({ id, amount }: { id: string; amount: number }) {
  switch (id) {
    case 'chest':
    case 'sarcophagus':
      return <Chest amount={amount} fancy={id === 'sarcophagus'} />;
    case 'crate':
      return <Crate />;
    case 'column':
      return <Column />;
    case 'torch':
      return <Torch />;
    case 'campfire':
      return <Campfire />;
    case 'altar':
      return <Altar lit={amount} />;
    case 'boulder':
      return <Boulder />;
    case 'pedestal':
      return <Pedestal />;
    case 'statue':
    case 'idol':
    case 'angel':
      return <Statue broken={amount * (id === 'statue' ? 1 : 0)} />;
    case 'door':
    case 'runed-door':
    case 'secret-door':
      return <Door amount={amount} runed={id === 'runed-door'} />;
    case 'gate':
      return <Gate amount={amount} />;
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
      return <ArrowTrap />;
    case 'book':
      return <Book amount={amount} />;
    case 'potion':
      return <Potion />;
    case 'sword':
      return <Sword />;
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

function Door({ amount, runed }: { amount: number; runed: boolean }) {
  // Unit cube: Y 0→1 matches wall height after PropMesh3D Y scale.
  // Base +90° so the panel spans X at prop rotation 0 — matches 2D door art.
  return (
    <group rotation={[0, Math.PI / 2, 0]}>
      <group rotation={[0, amount * 1.2, 0]} position={[amount * 0.35, 0, 0]}>
        <Box args={[0.1, 0.98, 0.88]} position={[0, 0.5, 0]} color={runed ? '#4a3a5a' : WOOD} />
        <Box args={[0.04, 0.07, 0.07]} position={[0.07, 0.48, -0.32]} color={GOLD} metalness={0.5} />
        <Box args={[0.04, 0.07, 0.07]} position={[-0.07, 0.48, -0.32]} color={GOLD} metalness={0.5} />
        {runed && (
          <Box
            args={[0.02, 0.3, 0.3]}
            position={[0.06, 0.62, 0]}
            color={GOLD}
            emissive={GOLD}
            emissiveIntensity={0.35}
          />
        )}
      </group>
    </group>
  );
}

function Gate({ amount }: { amount: number }) {
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
          color={IRON}
          metalness={0.55}
          roughness={0.4}
        />
      ))}
      <Box args={[0.86, 0.05, 0.05]} position={[0, 0.22, 0]} color={IRON_DARK} metalness={0.5} />
      <Box args={[0.86, 0.05, 0.05]} position={[0, 0.5, 0]} color={IRON_DARK} metalness={0.5} />
      <Box args={[0.86, 0.05, 0.05]} position={[0, 0.78, 0]} color={IRON_DARK} metalness={0.5} />
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
  const h = 0.2 + amount * 0.5;
  return (
    <group>
      <Box args={[0.7, 0.06, 0.7]} position={[0, 0.03, 0]} color={STONE_DARK} />
      {[-0.15, 0, 0.15].map((x) => (
        <Cyl
          key={x}
          args={[0.03, 0.02, h, 6]}
          position={[x, h / 2 + 0.02, 0]}
          color={IRON}
          metalness={0.55}
        />
      ))}
    </group>
  );
}

function BladeTrap({ amount }: { amount: number }) {
  return (
    <group>
      <Box args={[0.65, 0.08, 0.65]} position={[0, 0.04, 0]} color={IRON_DARK} metalness={0.4} />
      <Box
        args={[0.55, 0.04, 0.12]}
        position={[0, 0.12 + amount * 0.23, 0]}
        rotation={[0, 0, amount * 0.4]}
        color={IRON}
        metalness={0.65}
        roughness={0.3}
      />
    </group>
  );
}

function ArrowTrap() {
  return (
    <group>
      <Box args={[0.55, 0.35, 0.35]} position={[0, 0.2, 0]} color={STONE} />
      <Cyl args={[0.06, 0.06, 0.25, 8]} position={[0, 0.22, 0.25]} rotation={[Math.PI / 2, 0, 0]} color={IRON_DARK} metalness={0.5} />
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

/** True when we have a dedicated procedural mesh for this prop id. */
export function hasPropMesh3D(propId: string | undefined): boolean {
  if (!propId) return false;
  return propId.length > 0;
}
