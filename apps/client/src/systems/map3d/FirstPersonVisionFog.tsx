import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import {
  fpVisionRadiusPx,
  hasDarkvision,
  lightsVisibleToViewers,
  tokenMapOrigin,
  worldToMapLocal,
} from '@/systems/map/fogLos';
import { visionWalls } from '@/systems/map/props/doorCollision';
import { GRIMOIRE_LIGHT_NAME } from '@/systems/scene/sceneLights';
import { getActiveMap, useItemStore } from '@/systems/scene/store/itemStore';
import { getActiveTimeOfDay } from '@/systems/scene/media/sceneMediaStore';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';

type LightSnap = {
  ambient: Array<{ light: THREE.AmbientLight; intensity: number; color: THREE.Color }>;
  dirs: Array<{ light: THREE.Light; intensity: number }>;
  points: Array<{ light: THREE.PointLight; intensity: number; visible: boolean }>;
};
type SceneFog = THREE.Fog | THREE.FogExp2;

const DV_AMB_NAME = 'fp-fow-ambient';
const SHELL_NAME = 'fp-vision-shell';

/**
 * FP hard sight (FoW bubble) is on whenever table fog or midnight is active.
 * GM included — dungeon gen / modular play in first person should be black past vision.
 */
export function fpHardVisionActive(): boolean {
  if (!useFirstPersonStore.getState().enabled) return false;
  return isFogOverlayVisible();
}

function enableSceneFogMaterials(scene: THREE.Scene): void {
  scene.traverse((o) => {
    if (o.name === SHELL_NAME) return;
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (mat && 'fog' in mat && (mat as THREE.MeshBasicMaterial).fog === false) {
        (mat as THREE.MeshBasicMaterial).fog = true;
      }
    }
  });
}

/**
 * FoW / midnight sight: even ambient + hard black past vision ft.
 * A camera-centered shell occludes Kenney/KayKit GLBs that ignore THREE.Fog.
 */
export function FirstPersonVisionFog(_props: { wallHeight: number }) {
  const fpOn = useFirstPersonStore((s) => s.enabled);
  const { scene } = useThree();
  const prevLights = useRef<LightSnap | null>(null);
  const prevFog = useRef<SceneFog | null>(null);
  const ownFog = useRef<THREE.Fog | null>(null);
  const visionOn = useRef(false);
  const fillRef = useRef<THREE.AmbientLight | null>(null);
  const prevEnv = useRef<THREE.Texture | null>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const fogMatTick = useRef(0);

  useEffect(() => {
    purgeOrphanVisionPointLights(scene);
    const amb = new THREE.AmbientLight('#e8eef8', 0);
    amb.visible = false;
    amb.name = DV_AMB_NAME;
    scene.add(amb);
    fillRef.current = amb;
    return () => {
      teardownVision(scene, prevLights, prevFog, ownFog, visionOn, prevEnv);
      if (fillRef.current) {
        scene.remove(fillRef.current);
        fillRef.current.dispose();
        fillRef.current = null;
      }
    };
  }, [scene]);

  useFrame(({ camera }) => {
    purgeOrphanVisionPointLights(scene);
    const wantVision = fpOn && fpHardVisionActive();
    const fill = fillRef.current;
    const shell = shellRef.current;

    if (!wantVision) {
      if (visionOn.current) {
        teardownVision(scene, prevLights, prevFog, ownFog, visionOn, prevEnv);
      }
      if (fill) {
        fill.visible = false;
        fill.intensity = 0;
      }
      if (shell) {
        shell.visible = false;
        if (shell.parent && shell.parent !== scene) scene.add(shell);
      }
      return;
    }

    if (!visionOn.current) {
      applyVision(scene, prevLights, prevFog, ownFog, visionOn, prevEnv);
    } else {
      muteWorldLights(scene, prevLights);
      scene.environment = null;
    }

    const token = resolveFirstPersonToken();
    const map = getActiveMap();
    const grid = map?.gridSize || 96;
    let radiusPx = token ? fpVisionRadiusPx(token, grid) : grid * 6;
    const dv = token ? hasDarkvision(token) : getActiveTimeOfDay() === 'midnight';
    const items = useItemStore.getState().items;
    const walls = map ? visionWalls(map, items) : [];
    const lights = map && token
      ? lightsVisibleToViewers(map, items, [token], walls)
      : [];
    if (map && token && lights.length > 0) {
      const origin = tokenMapOrigin(token, map);
      for (const light of lights) {
        const lo = worldToMapLocal(light.wx, light.wy, map);
        const reach = Math.hypot(lo.x - origin.x, lo.y - origin.y) + (light.totalFt / 5) * grid;
        radiusPx = Math.max(radiusPx, reach);
      }
    }

    if (fill) {
      fill.visible = true;
      fill.color.set(dv ? '#e8eef8' : '#ffe2b0');
      fill.intensity = lights.length > 0 ? (dv ? 0.45 : 0.18) : (dv ? 2.4 : 0.12);
    }

    const fog = ownFog.current;
    if (fog) {
      fog.near = Math.max(8, radiusPx * 0.92);
      fog.far = Math.max(fog.near + 8, radiusPx);
      fog.color.set('#000000');
      if (scene.fog !== fog) scene.fog = fog;
    }
    if (!(scene.background instanceof THREE.Color) || scene.background.getHex() !== 0x000000) {
      scene.background = new THREE.Color('#000000');
    }

    if (shell) {
      if (shell.parent !== camera) camera.add(shell);
      shell.visible = true;
      shell.position.set(0, 0, 0);
      shell.quaternion.identity();
      shell.scale.setScalar(Math.max(24, radiusPx));
    }

    fogMatTick.current += 1;
    if (fogMatTick.current % 30 === 1) enableSceneFogMaterials(scene);
  });

  return (
    <mesh
      ref={shellRef}
      name={SHELL_NAME}
      visible={false}
      frustumCulled={false}
      renderOrder={40}
    >
      <sphereGeometry args={[1, 48, 32]} />
      <meshBasicMaterial
        color="#000000"
        side={THREE.BackSide}
        depthTest
        depthWrite
        fog={false}
        toneMapped={false}
      />
    </mesh>
  );
}

function purgeOrphanVisionPointLights(scene: THREE.Scene) {
  const kill: THREE.PointLight[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.PointLight)) return;
    if (o.name === GRIMOIRE_LIGHT_NAME) return;
    if (o.decay === 0 && o.distance >= 80) kill.push(o);
  });
  for (const light of kill) {
    light.intensity = 0;
    light.visible = false;
    light.parent?.remove(light);
    light.dispose();
  }
}

function muteWorldLights(
  scene: THREE.Scene,
  prevLights: { current: LightSnap | null },
) {
  if (!prevLights.current) return;
  for (const a of prevLights.current.ambient) a.light.intensity = 0;
  for (const d of prevLights.current.dirs) d.light.intensity = 0;
  for (const p of prevLights.current.points) {
    if (p.light.name === GRIMOIRE_LIGHT_NAME) continue;
    p.light.intensity = 0;
    p.light.visible = false;
  }
  scene.traverse((o) => {
    if (o instanceof THREE.AmbientLight && o.name !== DV_AMB_NAME && o.intensity > 0) {
      prevLights.current!.ambient.push({
        light: o,
        intensity: o.intensity,
        color: o.color.clone(),
      });
      o.intensity = 0;
    }
    if (
      (o instanceof THREE.DirectionalLight || o instanceof THREE.HemisphereLight)
      && o.intensity > 0
    ) {
      prevLights.current!.dirs.push({ light: o, intensity: o.intensity });
      o.intensity = 0;
    }
  });
}

function applyVision(
  scene: THREE.Scene,
  prevLights: { current: LightSnap | null },
  prevFog: { current: SceneFog | null },
  ownFog: { current: THREE.Fog | null },
  visionOn: { current: boolean },
  prevEnv: { current: THREE.Texture | null },
) {
  if (!prevLights.current) {
    const ambient: LightSnap['ambient'] = [];
    const dirs: LightSnap['dirs'] = [];
    const points: LightSnap['points'] = [];
    scene.traverse((o) => {
      if (o instanceof THREE.AmbientLight && o.name !== DV_AMB_NAME) {
        ambient.push({ light: o, intensity: o.intensity, color: o.color.clone() });
        o.intensity = 0;
      }
      if (o instanceof THREE.DirectionalLight || o instanceof THREE.HemisphereLight) {
        dirs.push({ light: o, intensity: o.intensity });
        o.intensity = 0;
      }
      if (o instanceof THREE.PointLight && o.name !== GRIMOIRE_LIGHT_NAME) {
        points.push({ light: o, intensity: o.intensity, visible: o.visible });
        o.intensity = 0;
        o.visible = false;
      }
    });
    prevLights.current = { ambient, dirs, points };
  }

  if (prevEnv.current === null && scene.environment) {
    prevEnv.current = scene.environment;
  }
  scene.environment = null;
  enableSceneFogMaterials(scene);

  if (
    !prevFog.current
    && scene.fog
    && (scene.fog instanceof THREE.Fog || scene.fog instanceof THREE.FogExp2)
    && scene.fog !== ownFog.current
  ) {
    prevFog.current = scene.fog;
  }
  if (!ownFog.current) {
    ownFog.current = new THREE.Fog('#000000', 200, 220);
  }
  scene.fog = ownFog.current;
  scene.background = new THREE.Color('#000000');
  visionOn.current = true;
}

function teardownVision(
  scene: THREE.Scene,
  prevLights: { current: LightSnap | null },
  prevFog: { current: SceneFog | null },
  ownFog: { current: THREE.Fog | null },
  visionOn: { current: boolean },
  prevEnv: { current: THREE.Texture | null },
) {
  if (prevLights.current) {
    for (const a of prevLights.current.ambient) {
      a.light.intensity = a.intensity;
      a.light.color.copy(a.color);
    }
    for (const d of prevLights.current.dirs) {
      d.light.intensity = d.intensity;
    }
    for (const p of prevLights.current.points) {
      p.light.intensity = p.intensity;
      p.light.visible = p.visible;
    }
    prevLights.current = null;
  }
  if (prevEnv.current) {
    scene.environment = prevEnv.current;
    prevEnv.current = null;
  }
  if (ownFog.current && scene.fog === ownFog.current) {
    scene.fog = prevFog.current;
  }
  prevFog.current = null;
  scene.background = new THREE.Color('#1e1e22');
  visionOn.current = false;
}
