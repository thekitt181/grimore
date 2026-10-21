import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { TimeOfDay } from '@grimoire/shared';
import { getActiveTimeOfDay, useSceneMediaStore } from '@/systems/scene/media/sceneMediaStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { fpHardVisionActive } from './FirstPersonVisionFog';

export type TimeLightRig = {
  ambient: number;
  ambientColor: string;
  sunIntensity: number;
  sunColor: string;
  sunPos: [number, number, number];
  fillIntensity: number;
  fillColor: string;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  envIntensity: number;
  fogColor: string;
  fogDensity: number;
  background: string;
  tintColor: string;
  tintOpacity: number;
  stars: boolean;
};

/** Global map-wide lighting + atmosphere — never player-centered discs. */
export const TIME_LIGHT_RIG: Record<TimeOfDay, TimeLightRig> = {
  dawn: {
    ambient: 0.55,
    ambientColor: '#ffd4b8',
    sunIntensity: 1.05,
    sunColor: '#ffb078',
    sunPos: [-600, 420, 800],
    fillIntensity: 0.45,
    fillColor: '#8090c0',
    hemiSky: '#ffc8a0',
    hemiGround: '#3a2a22',
    hemiIntensity: 0.5,
    envIntensity: 0.28,
    fogColor: '#c8a888',
    fogDensity: 0.00038,
    background: '#2a221c',
    tintColor: '#ff9a50',
    tintOpacity: 0.1,
    stars: false,
  },
  day: {
    ambient: 1.05,
    ambientColor: '#ffffff',
    sunIntensity: 1.35,
    sunColor: '#fff5e6',
    sunPos: [800, 1400, 500],
    fillIntensity: 0.65,
    fillColor: '#ffffff',
    hemiSky: '#f0ece4',
    hemiGround: '#2a2520',
    hemiIntensity: 0.55,
    envIntensity: 0.4,
    fogColor: '#1e1e22',
    fogDensity: 0,
    background: '#1e1e22',
    tintColor: '#ffffff',
    tintOpacity: 0,
    stars: false,
  },
  'golden-hour': {
    ambient: 0.7,
    ambientColor: '#ffc090',
    sunIntensity: 1.2,
    sunColor: '#ff9a40',
    sunPos: [1100, 380, -200],
    fillIntensity: 0.4,
    fillColor: '#6050a0',
    hemiSky: '#ffb060',
    hemiGround: '#2a1810',
    hemiIntensity: 0.48,
    envIntensity: 0.32,
    fogColor: '#a87850',
    fogDensity: 0.00032,
    background: '#2a1c14',
    tintColor: '#ff8a30',
    tintOpacity: 0.12,
    stars: false,
  },
  dusk: {
    ambient: 0.42,
    ambientColor: '#c090b0',
    sunIntensity: 0.75,
    sunColor: '#ff7040',
    sunPos: [900, 220, -700],
    fillIntensity: 0.55,
    fillColor: '#4050a0',
    hemiSky: '#8060a0',
    hemiGround: '#1a1218',
    hemiIntensity: 0.42,
    envIntensity: 0.22,
    fogColor: '#403050',
    fogDensity: 0.0005,
    background: '#18141e',
    tintColor: '#6030a0',
    tintOpacity: 0.14,
    stars: false,
  },
  night: {
    ambient: 0.22,
    ambientColor: '#6080c0',
    sunIntensity: 0.28,
    sunColor: '#b0c4ff',
    sunPos: [-400, 900, 200],
    fillIntensity: 0.35,
    fillColor: '#304878',
    hemiSky: '#101828',
    hemiGround: '#080a10',
    hemiIntensity: 0.28,
    envIntensity: 0.12,
    fogColor: '#0a1020',
    fogDensity: 0.0007,
    background: '#080c14',
    tintColor: '#102040',
    tintOpacity: 0.2,
    stars: true,
  },
  // Midnight = thick global fog over the whole map (not a player circle / DV lamp).
  midnight: {
    ambient: 0.1,
    ambientColor: '#304060',
    sunIntensity: 0.08,
    sunColor: '#6070a0',
    sunPos: [200, 1000, -400],
    fillIntensity: 0.14,
    fillColor: '#101828',
    hemiSky: '#04060c',
    hemiGround: '#010204',
    hemiIntensity: 0.12,
    envIntensity: 0.04,
    fogColor: '#020408',
    fogDensity: 0.00185,
    background: '#020408',
    tintColor: '#030508',
    tintOpacity: 0.18,
    stars: true,
  },
};

/** Full-scene multiply veil — huge sphere so orbit + FP both get map-wide tint. */
function SkyTint({ color, opacity }: { color: string; opacity: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const m = meshRef.current;
    if (!m) return;
    m.position.copy(camera.position);
  });
  if (opacity < 0.01) return null;
  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={6}>
      <sphereGeometry args={[12000, 24, 16]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.MultiplyBlending}
      />
    </mesh>
  );
}

function NightStars3D() {
  const pointsRef = useRef<THREE.Points>(null);
  const { positions, phases } = useMemo(() => {
    const n = 180;
    const positions = new Float32Array(n * 3);
    const phases = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI * 0.45;
      const r = 9000;
      const o = i * 3;
      positions[o] = r * Math.sin(phi) * Math.cos(theta);
      positions[o + 1] = r * Math.cos(phi) * 0.55 + 400;
      positions[o + 2] = r * Math.sin(phi) * Math.sin(theta);
      phases[i] = Math.random() * Math.PI * 2;
    }
    return { positions, phases };
  }, []);

  const matRef = useRef<THREE.PointsMaterial>(null);

  useFrame(({ camera }) => {
    const pts = pointsRef.current;
    if (!pts) return;
    pts.position.copy(camera.position);
    const mat = matRef.current;
    if (mat) {
      const t = performance.now() / 1000;
      mat.opacity = 0.55 + Math.sin(t * 1.4 + phases[0]!) * 0.15;
    }
  });

  return (
    <points ref={pointsRef} frustumCulled={false} renderOrder={5}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color="#dce6ff"
        size={18}
        sizeAttenuation
        transparent
        opacity={0.65}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

function SceneBackground({ color }: { color: string }) {
  const target = useMemo(() => new THREE.Color(color), [color]);
  useFrame(({ scene }) => {
    // FoW / midnight DV hard sight paints its own black void.
    if (fpHardVisionActive()) return;

    if (!(scene.background instanceof THREE.Color)) {
      scene.background = target.clone();
      return;
    }
    if (!scene.background.equals(target)) scene.background.copy(target);
  });
  return null;
}

function SceneFog({ color, density }: { color: string; density: number }) {
  useFrame(({ scene }) => {
    // FoW or midnight darkvision owns linear Fog — otherwise map-wide time fog.
    if (fpHardVisionActive()) return;

    if (density <= 0) {
      if (scene.fog instanceof THREE.FogExp2) scene.fog = null;
      return;
    }
    const fog = scene.fog;
    if (fog instanceof THREE.FogExp2) {
      fog.color.set(color);
      fog.density = density;
    } else {
      scene.fog = new THREE.FogExp2(color, density);
    }
  });
  return null;
}

/**
 * Map-wide time-of-day for 3D / FP: lighting comes from {@link TIME_LIGHT_RIG}
 * in Map3DSceneContent; this adds background, distance fog, sky tint, and stars.
 * Midnight is thick global fog — not a light circle around the player.
 */
export function FpTimeOfDay3D() {
  const view3d = useMapStore((s) => s.viewMode === '3d');
  const timeOfDay = useSceneMediaStore(() => getActiveTimeOfDay());
  const rig = TIME_LIGHT_RIG[timeOfDay];

  if (!view3d) return null;

  return (
    <group>
      <SceneBackground color={rig.background} />
      <SceneFog color={rig.fogColor} density={rig.fogDensity} />
      <SkyTint color={rig.tintColor} opacity={rig.tintOpacity} />
      {rig.stars && <NightStars3D />}
    </group>
  );
}

/** Hook-friendly snapshot of the active time lighting rig. */
export function useTimeLightRig(): TimeLightRig {
  const timeOfDay = useSceneMediaStore(() => getActiveTimeOfDay());
  return TIME_LIGHT_RIG[timeOfDay];
}
