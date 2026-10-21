import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ImageItem } from '@/systems/scene/types';
import { propArtById, type PropPlay } from '@/systems/map/props/propArt';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import {
  propPose,
  propSpringPose,
  propShotElapsed,
  propPlayDuration,
} from '@/systems/map/props/propPose';

const FLAME = '#ff8a2b';
const _lidEuler = new THREE.Euler();

function isLidObject(obj: THREE.Object3D): boolean {
  const n = obj.name.toLowerCase();
  return n.includes('lid') || n.endsWith('_cover') || n.includes('top_lid');
}

function liveAmountFor(item: ImageItem): number {
  const propId = resolvePropId(item);
  const art = propId ? propArtById(propId) : undefined;
  const play = art?.play ?? 'still';
  const dur = propPlayDuration(play);
  if (play === 'rise' || play === 'snap' || play === 'spread') {
    return Math.min(1, Math.max(0, propSpringPose(item, dur)));
  }
  return propPose(item, dur);
}

/**
 * Drive 3D prop motion from the same propState / propAt timing as 2D sprites.
 * - GLB chests: hinge `*_lid` nodes
 * - Group transforms: swing / press / rise / drop / snap / breathe / …
 * - Lights: flicker + ignite intensity
 * - `driveGroup={false}` when procedural meshes already pose themselves via amount
 */
export function PropAnim3D({
  item,
  size,
  light,
  driveGroup = true,
  children,
}: {
  item: ImageItem;
  size: number;
  light?: 'torch' | 'campfire' | 'altar';
  /** When false, only lights / projectiles / loot — mesh owns lid/door pose. */
  driveGroup?: boolean;
  children: ReactNode;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const projectileRefs = useRef<(THREE.Mesh | null)[]>([]);
  const burstRef = useRef<THREE.Mesh>(null);

  const propId = resolvePropId(item);
  const art = propId ? propArtById(propId) : undefined;
  const play: PropPlay = art?.play ?? 'still';
  const s = Math.max(size, 8);

  const lightBase = useMemo(() => {
    if (light === 'campfire') return { y: s * 0.38, intensity: 3.4, distance: s * 7 };
    if (light === 'torch') return { y: s * 0.72, intensity: 2.4, distance: s * 5.5 };
    if (light === 'altar') return { y: s * 0.55, intensity: 1.9, distance: s * 4.5 };
    return null;
  }, [light, s]);

  useFrame(({ clock }) => {
    const root = rootRef.current;
    if (!root) return;
    const now = clock.elapsedTime;
    const dur = propPlayDuration(play);
    const p =
      play === 'rise' || play === 'snap' || play === 'spread'
        ? Math.min(1, Math.max(0, propSpringPose(item, dur)))
        : propPose(item, dur);
    const shot = propShotElapsed(item);

    // Reset wrapper each frame, then apply play motion (GLB path).
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.set(1, 1, 1);

    if (driveGroup) {
      // Lid hinge on KayKit chests (and any future *_lid nodes).
      let hinged = false;
      root.traverse((obj) => {
        if (!isLidObject(obj) || obj === root) return;
        hinged = true;
        // Closed = identity; open = tip back ~60°.
        _lidEuler.set(-1.05 * p, 0, 0);
        obj.rotation.copy(_lidEuler);
      });

      switch (play) {
        case 'lift':
          if (!hinged) {
            root.rotation.x = -0.35 * p;
            root.position.y = p * s * 0.04;
          }
          break;
        case 'swing':
          root.rotation.y = p * 1.35;
          root.position.x = p * s * 0.28;
          break;
        case 'split':
          root.scale.x = 1 - p * 0.88;
          root.position.y = -p * s * 0.08;
          break;
        case 'rise':
          root.position.y = p * s * 0.55;
          break;
        case 'snap': {
          const openAmt = 1 - p;
          root.rotation.z = openAmt * 0.55;
          root.scale.setScalar(0.82 + p * 0.22);
          break;
        }
        case 'press':
          root.position.y = -p * s * 0.06;
          root.scale.y = 1 - p * 0.18;
          break;
        case 'drop':
          root.position.y = (1 - p) * -s * 0.55;
          break;
        case 'swap':
        case 'flow':
          root.scale.setScalar(0.94 + p * 0.06);
          break;
        case 'spread':
          root.scale.setScalar(0.15 + p * 0.85);
          break;
        case 'breathe': {
          const wave = 0.5 + 0.5 * Math.sin(now * 2.4);
          root.scale.setScalar(0.94 + wave * 0.1);
          break;
        }
        case 'pulse': {
          const hit = shot >= 0 && shot < 0.4 ? Math.sin((shot / 0.4) * Math.PI) : 0;
          root.scale.setScalar(1 + hit * 0.22);
          break;
        }
        default:
          break;
      }
    }

    if (play === 'burst') {
      const ring = burstRef.current;
      if (ring) {
        if (shot < 0 || shot > 0.7) {
          ring.visible = false;
        } else {
          const t = shot / 0.7;
          ring.visible = true;
          ring.scale.setScalar(0.7 + t * 0.55);
          const mat = ring.material as THREE.MeshStandardMaterial;
          mat.opacity = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
          mat.transparent = true;
        }
      }
    }

    if (play === 'shoot') {
      projectileRefs.current.forEach((mesh, i) => {
        if (!mesh) return;
        const t = (shot - i * 0.05) / 0.42;
        if (t <= 0 || t >= 1) {
          mesh.visible = false;
          return;
        }
        mesh.visible = true;
        mesh.position.set((i - 1) * s * 0.12, s * 0.35 + t * s * 1.4, 0);
        const mat = mesh.material as THREE.MeshStandardMaterial;
        mat.opacity = t < 0.75 ? 1 : (1 - t) / 0.25;
        mat.transparent = true;
      });
    }

    const pl = lightRef.current;
    if (pl && lightBase) {
      let intensity = lightBase.intensity;
      if (play === 'ignite') intensity *= p;
      if (play === 'flicker' || (play === 'ignite' && p > 0.04)) {
        const flicker =
          0.82 + Math.sin(now * 9.2) * 0.1 + Math.sin(now * 14.1 + 1.7) * 0.08;
        intensity *= flicker;
        pl.position.y = lightBase.y + Math.sin(now * 7.5) * s * 0.012;
      } else {
        pl.position.y = lightBase.y;
      }
      pl.intensity = intensity;
      pl.visible = intensity > 0.05;
    }
  });

  return (
    <group ref={rootRef}>
      {children}
      {lightBase ? (
        <pointLight
          ref={lightRef}
          position={[0, lightBase.y, 0]}
          color={FLAME}
          intensity={lightBase.intensity}
          distance={lightBase.distance}
          decay={2}
        />
      ) : null}
      {play === 'shoot'
        ? [0, 1, 2].map((i) => (
            <mesh
              key={i}
              ref={(m) => {
                projectileRefs.current[i] = m;
              }}
              visible={false}
              castShadow
            >
              <coneGeometry args={[s * 0.04, s * 0.22, 6]} />
              <meshStandardMaterial color="#c9a84c" metalness={0.4} roughness={0.45} />
            </mesh>
          ))
        : null}
      {play === 'burst' ? (
        <mesh ref={burstRef} visible={false} position={[0, s * 0.15, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[s * 0.15, s * 0.42, 24]} />
          <meshStandardMaterial
            color="#c9a84c"
            emissive="#c9a84c"
            emissiveIntensity={0.8}
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ) : null}
      {/* Loot peek for GLB chests (procedural chest draws its own gold). */}
      {driveGroup && play === 'lift' && propId === 'chest' ? (
        <ChestLoot amountRef={item} size={s} />
      ) : null}
    </group>
  );
}

function ChestLoot({ amountRef, size }: { amountRef: ImageItem; size: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const m = ref.current;
    if (!m) return;
    const p = propPose(amountRef, 0.5);
    m.visible = p > 0.35;
    m.position.y = size * (0.22 + p * 0.1);
    m.scale.setScalar(0.55 + p * 0.45);
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.opacity = Math.min(1, (p - 0.35) / 0.35);
    mat.transparent = true;
  });
  return (
    <mesh ref={ref} visible={false} castShadow>
      <boxGeometry args={[size * 0.22, size * 0.08, size * 0.16]} />
      <meshStandardMaterial
        color="#c9a84c"
        metalness={0.65}
        roughness={0.35}
        emissive="#6a4a18"
        emissiveIntensity={0.35}
        transparent
        opacity={0}
      />
    </mesh>
  );
}

/** Live 0–1 amount for procedural meshes — re-renders while a pose is in flight. */
export function useLivePropAmount(item: ImageItem): number {
  const amountRef = useRef(liveAmountFor(item));
  const [, bump] = useState(0);
  useFrame(() => {
    const next = liveAmountFor(item);
    if (Math.abs(next - amountRef.current) < 0.002) return;
    amountRef.current = next;
    bump((n) => n + 1);
  });
  return amountRef.current;
}
