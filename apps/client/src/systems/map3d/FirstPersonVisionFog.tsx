import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { isSessionFogToggled } from '@/systems/scene/fogActiveSync';
import { fpVisionRadiusPx, hasDarkvision } from '@/systems/map/fogLos';
import { getActiveTimeOfDay } from '@/systems/scene/media/sceneMediaStore';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import { useSessionStore } from '@/store/sessionStore';

type LightSnap = {
  ambient: Array<{ light: THREE.AmbientLight; intensity: number; color: THREE.Color }>;
  dirs: Array<{ light: THREE.Light; intensity: number }>;
  points: Array<{ light: THREE.PointLight; intensity: number; visible: boolean }>;
};
type SceneFog = THREE.Fog | THREE.FogExp2;

const DV_AMB_NAME = 'fp-fow-ambient';

/**
 * FP hard sight (FoW bubble) is on when:
 * - midnight (everyone in FP, including GM — otherwise midnight is just black fog), or
 * - table fog toggled for non-GM players
 */
export function fpHardVisionActive(): boolean {
  if (!useFirstPersonStore.getState().enabled) return false;
  // Midnight darkness for everyone in FP (GM included — otherwise it’s just black).
  if (getActiveTimeOfDay() === 'midnight') return true;
  // Table fog: players only (GM keeps full FP light while fog is on for the table).
  if (useSessionStore.getState().myRole === 'GM') return false;
  return isSessionFogToggled();
}

/**
 * FoW / midnight sight: even ambient + hard fog at vision ft.
 * Never camera PointLights (floor disc).
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

  useFrame(() => {
    purgeOrphanVisionPointLights(scene);
    const wantVision = fpOn && fpHardVisionActive();
    const fill = fillRef.current;

    if (!wantVision) {
      if (visionOn.current) {
        teardownVision(scene, prevLights, prevFog, ownFog, visionOn, prevEnv);
      }
      if (fill) {
        fill.visible = false;
        fill.intensity = 0;
      }
      return;
    }

    if (!visionOn.current) {
      applyVision(scene, prevLights, prevFog, ownFog, visionOn, prevEnv);
    } else {
      // React re-applies timeRig light intensities — keep them muted every frame.
      muteWorldLights(scene, prevLights);
    }

    const token = resolveFirstPersonToken();
    const map = getActiveMap();
    const grid = map?.gridSize || 96;
    const radiusPx = token ? fpVisionRadiusPx(token, grid) : grid * 6;
    const dv = token ? hasDarkvision(token) : getActiveTimeOfDay() === 'midnight';

    if (fill) {
      fill.visible = true;
      fill.color.set(dv ? '#e8eef8' : '#ffe2b0');
      // Bright enough that MeshStandard walls/floors read clearly inside the bubble.
      fill.intensity = dv ? 2.4 : 2.8;
    }

    const fog = ownFog.current;
    if (fog) {
      fog.near = Math.max(12, radiusPx * 0.88);
      fog.far = Math.max(fog.near + 24, radiusPx);
      fog.color.set('#000000');
      if (scene.fog !== fog) scene.fog = fog;
    }
    if (!(scene.background instanceof THREE.Color) || scene.background.getHex() !== 0x000000) {
      scene.background = new THREE.Color('#000000');
    }
  });

  return null;
}

function purgeOrphanVisionPointLights(scene: THREE.Scene) {
  const kill: THREE.PointLight[] = [];
  scene.traverse((o) => {
    if (!(o instanceof THREE.PointLight)) return;
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
    p.light.intensity = 0;
    p.light.visible = false;
  }
  // Pick up any lights React remounted after the first snap.
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
      if (o instanceof THREE.PointLight) {
        points.push({ light: o, intensity: o.intensity, visible: o.visible });
        o.intensity = 0;
        o.visible = false;
      }
    });
    prevLights.current = { ambient, dirs, points };
  }

  if (prevEnv.current === null && scene.environment) {
    prevEnv.current = scene.environment;
    scene.environment = null;
  }

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
