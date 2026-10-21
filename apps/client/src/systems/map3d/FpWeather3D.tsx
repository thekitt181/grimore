import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { WeatherOverlay, WeatherSettings } from '@grimoire/shared';
import {
  DEFAULT_WEATHER_SETTINGS,
  selectEffectiveWeather,
  useSceneMediaStore,
  type ActiveWeatherOverlay,
} from '@/systems/scene/media/sceneMediaStore';
import { useMapStore } from '@/systems/map/store/mapStore';

/** Match 2D atmosphere defaults so GM weather picks feel consistent. */
const WEATHER_DEFAULTS: Partial<
  Record<ActiveWeatherOverlay, Partial<WeatherSettings>>
> = {
  rain: { cover: 55, wind: 35, direction: 195 },
  'heavy-rain': { cover: 80, wind: 55, direction: 190 },
  storm: { cover: 90, wind: 70, direction: 200 },
  hail: { cover: 75, wind: 45, direction: 195 },
  snow: { cover: 60, wind: 25, direction: 210 },
  blizzard: { cover: 95, wind: 85, direction: 220 },
  fog: { cover: 75, wind: 10, direction: 180 },
  mist: { cover: 50, wind: 15, direction: 175 },
  sandstorm: { cover: 85, wind: 90, direction: 270 },
  swamp: { cover: 65, wind: 12, direction: 180 },
  ash: { cover: 70, wind: 40, direction: 190 },
  embers: { cover: 50, wind: 30, direction: 170 },
  leaves: { cover: 45, wind: 50, direction: 90 },
  fireflies: { cover: 40, wind: 8, direction: 160 },
  aurora: { cover: 60, wind: 5, direction: 0 },
};

function isRainFamily(w: WeatherOverlay): boolean {
  return w === 'rain' || w === 'heavy-rain' || w === 'storm';
}

function isSnowFamily(w: WeatherOverlay): boolean {
  return w === 'snow' || w === 'blizzard';
}

function particleCount(weather: ActiveWeatherOverlay, cover: number): number {
  const d = cover / 100;
  switch (weather) {
    case 'rain': return Math.floor(400 + d * 500);
    case 'heavy-rain': return Math.floor(700 + d * 700);
    case 'storm': return Math.floor(900 + d * 800);
    case 'hail': return Math.floor(280 + d * 320);
    case 'snow': return Math.floor(350 + d * 450);
    case 'blizzard': return Math.floor(700 + d * 700);
    case 'sandstorm': return Math.floor(500 + d * 600);
    case 'ash': return Math.floor(320 + d * 400);
    case 'embers': return Math.floor(120 + d * 180);
    case 'leaves': return Math.floor(90 + d * 140);
    case 'fireflies': return Math.floor(60 + d * 80);
    case 'swamp': return Math.floor(80 + d * 100);
    case 'mist': return Math.floor(40 + d * 50);
    case 'fog': return Math.floor(50 + d * 60);
    case 'aurora': return 0;
    default: return 0;
  }
}

function particleColor(weather: ActiveWeatherOverlay): THREE.Color {
  switch (weather) {
    case 'rain':
    case 'heavy-rain':
    case 'storm':
      return new THREE.Color(0xa0c4ff);
    case 'hail':
      return new THREE.Color(0xe8f0ff);
    case 'snow':
    case 'blizzard':
      return new THREE.Color(0xffffff);
    case 'sandstorm':
      return new THREE.Color(0xd2aa6e);
    case 'ash':
      return new THREE.Color(0x888890);
    case 'embers':
      return new THREE.Color(0xff6a28);
    case 'leaves':
      return new THREE.Color(0xb45a1e);
    case 'fireflies':
      return new THREE.Color(0xb4ff5a);
    case 'swamp':
      return new THREE.Color(0x8cdc64);
    case 'fog':
    case 'mist':
      return new THREE.Color(0xd0d8e0);
    default:
      return new THREE.Color(0xffffff);
  }
}

function particleSize(weather: ActiveWeatherOverlay): number {
  if (isRainFamily(weather)) return 2.2;
  if (weather === 'hail') return 3.2;
  if (isSnowFamily(weather)) return 4.5;
  if (weather === 'sandstorm') return 2.8;
  if (weather === 'embers' || weather === 'fireflies') return 5.5;
  if (weather === 'leaves') return 6;
  if (weather === 'fog' || weather === 'mist') return 18;
  return 3.5;
}

type Vel = { vx: number; vy: number; vz: number };

function spawnVelocity(weather: ActiveWeatherOverlay, settings: WeatherSettings): Vel {
  const wind = settings.wind / 100;
  const rad = (settings.direction * Math.PI) / 180;
  const wx = Math.sin(rad) * wind * 90;
  const wz = Math.cos(rad) * wind * 90;
  const j = () => (Math.random() - 0.5);

  if (isRainFamily(weather)) {
    const heavy = weather !== 'rain';
    return {
      vx: wx * 0.35 + j() * 18,
      vy: -(heavy ? 220 : 160) - Math.random() * 80,
      vz: wz * 0.35 + j() * 18,
    };
  }
  if (weather === 'hail') {
    return { vx: wx * 0.4 + j() * 12, vy: -(280 + Math.random() * 60), vz: wz * 0.4 + j() * 12 };
  }
  if (isSnowFamily(weather)) {
    const blizzard = weather === 'blizzard';
    return {
      vx: wx * (blizzard ? 0.7 : 0.35) + j() * (blizzard ? 40 : 18),
      vy: -(blizzard ? 55 : 28) - Math.random() * (blizzard ? 40 : 22),
      vz: wz * (blizzard ? 0.7 : 0.35) + j() * (blizzard ? 40 : 18),
    };
  }
  if (weather === 'sandstorm') {
    return { vx: 80 + wx * 1.1 + Math.random() * 40, vy: j() * 25, vz: wz * 0.8 + j() * 30 };
  }
  if (weather === 'ash') {
    return { vx: wx * 0.4 + j() * 20, vy: -(35 + Math.random() * 40), vz: wz * 0.4 + j() * 20 };
  }
  if (weather === 'embers') {
    return { vx: j() * 25, vy: 40 + Math.random() * 55, vz: j() * 25 };
  }
  if (weather === 'leaves') {
    return { vx: 35 + wx * 0.5 + Math.random() * 25, vy: -8 - Math.random() * 20, vz: wz * 0.4 + j() * 20 };
  }
  if (weather === 'fireflies') {
    return { vx: j() * 12, vy: j() * 10, vz: j() * 12 };
  }
  if (weather === 'swamp') {
    return { vx: j() * 15, vy: 12 + Math.random() * 20, vz: j() * 15 };
  }
  // fog / mist — slow drift
  return { vx: j() * 8, vy: j() * 4, vz: j() * 8 };
}

const BOX = { x: 280, y: 220, z: 280 };

function respawn(
  i: number,
  positions: Float32Array,
  velocities: Float32Array,
  weather: ActiveWeatherOverlay,
  settings: WeatherSettings,
): void {
  const o = i * 3;
  positions[o] = (Math.random() - 0.5) * BOX.x * 2;
  positions[o + 2] = (Math.random() - 0.5) * BOX.z * 2;
  if (weather === 'embers' || weather === 'swamp') {
    positions[o + 1] = -BOX.y * 0.2 + Math.random() * BOX.y * 0.4;
  } else if (weather === 'sandstorm') {
    positions[o] = -BOX.x + Math.random() * 40;
    positions[o + 1] = (Math.random() - 0.5) * BOX.y * 1.6;
  } else if (weather === 'fireflies' || weather === 'fog' || weather === 'mist') {
    positions[o + 1] = (Math.random() - 0.5) * BOX.y * 1.4;
  } else {
    positions[o + 1] = BOX.y * (0.35 + Math.random() * 0.9);
  }
  const v = spawnVelocity(weather, settings);
  velocities[o] = v.vx;
  velocities[o + 1] = v.vy;
  velocities[o + 2] = v.vz;
}

function WeatherParticles({
  weather,
  settings,
}: {
  weather: ActiveWeatherOverlay;
  settings: WeatherSettings;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const count = Math.min(1800, particleCount(weather, settings.cover));
  const { positions, velocities } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      respawn(i, positions, velocities, weather, settings);
    }
    return { positions, velocities };
  }, [count, weather, settings.cover, settings.wind, settings.direction]);

  const color = useMemo(() => particleColor(weather), [weather]);
  const size = particleSize(weather);
  const opacity =
    weather === 'fog' || weather === 'mist' ? 0.12
      : weather === 'storm' ? 0.55
        : isRainFamily(weather) ? 0.45
          : 0.7;

  useFrame(({ camera }, dt) => {
    const pts = pointsRef.current;
    if (!pts) return;
    // World-aligned volume that follows the camera (no pitch/yaw — rain falls down).
    pts.position.copy(camera.position);

    const attr = pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    if (!attr) return;
    const arr = attr.array as Float32Array;
    const step = Math.min(0.05, Math.max(0, dt));
    const firefly = weather === 'fireflies';
    const t = performance.now() / 1000;

    for (let i = 0; i < count; i++) {
      const o = i * 3;
      let x = arr[o] ?? 0;
      let y = arr[o + 1] ?? 0;
      let z = arr[o + 2] ?? 0;
      const vx = velocities[o] ?? 0;
      const vy = velocities[o + 1] ?? 0;
      const vz = velocities[o + 2] ?? 0;
      if (firefly) {
        x += vx * step + Math.sin(t * 1.3 + i) * 0.35;
        y += vy * step + Math.cos(t * 1.1 + i) * 0.28;
        z += vz * step + Math.sin(t * 0.9 + i * 0.7) * 0.3;
      } else {
        x += vx * step;
        y += vy * step;
        z += vz * step;
      }
      arr[o] = x;
      arr[o + 1] = y;
      arr[o + 2] = z;

      const out =
        y < -BOX.y
        || y > BOX.y * 1.4
        || Math.abs(x) > BOX.x * 1.15
        || Math.abs(z) > BOX.z * 1.15;
      if (out) respawn(i, arr, velocities, weather, settings);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        sizeAttenuation
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={
          weather === 'fireflies' || isSnowFamily(weather) || weather === 'embers'
            ? THREE.AdditiveBlending
            : THREE.NormalBlending
        }
      />
    </points>
  );
}

function AuroraVeil() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const m = meshRef.current;
    if (!m) return;
    m.position.copy(camera.position);
    m.position.y += 40;
  });
  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={8}>
      <sphereGeometry args={[120, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.45]} />
      <meshBasicMaterial
        color="#50e0a0"
        transparent
        opacity={0.08}
        side={THREE.BackSide}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

function StormTint() {
  const meshRef = useRef<THREE.Mesh>(null);
  useFrame(({ camera }) => {
    const m = meshRef.current;
    if (!m) return;
    m.position.copy(camera.position);
  });
  return (
    <mesh ref={meshRef} frustumCulled={false} renderOrder={7}>
      <sphereGeometry args={[90, 16, 12]} />
      <meshBasicMaterial
        color="#1e2d50"
        transparent
        opacity={0.12}
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}

/**
 * World-space weather around the FP / 3D camera — rain falls in world Y,
 * volume follows the camera so it always surrounds the player.
 */
export function FpWeather3D() {
  const view3d = useMapStore((s) => s.viewMode === '3d');
  const activeScene = useSceneMediaStore((s) => s.activeScene);
  const sessionWeather = useSceneMediaStore((s) => s.sessionWeather);
  const sessionSettings = useSceneMediaStore((s) => s.sessionWeatherSettings);

  const weather = useMemo(
    () => selectEffectiveWeather({ activeScene, sessionWeather }),
    [activeScene, sessionWeather],
  );

  const settings = useMemo(() => {
    if (!weather) return DEFAULT_WEATHER_SETTINGS;
    return {
      ...DEFAULT_WEATHER_SETTINGS,
      ...sessionSettings,
      ...WEATHER_DEFAULTS[weather],
    };
  }, [weather, sessionSettings]);

  // 3D / FP only — 2D map keeps the canvas overlay.
  if (!view3d || !weather) return null;

  return (
    <group>
      {weather === 'aurora' ? (
        <AuroraVeil />
      ) : (
        <WeatherParticles key={weather} weather={weather} settings={settings} />
      )}
      {(weather === 'storm' || weather === 'blizzard' || weather === 'sandstorm') && (
        <StormTint />
      )}
    </group>
  );
}
