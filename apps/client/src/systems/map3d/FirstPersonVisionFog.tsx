import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { getActiveMap } from '@/systems/scene/store/itemStore';
import { isFogOverlayVisible } from '@/systems/scene/fogActiveSync';
import { fpVisionRadiusPx, hasDarkvision } from '@/systems/map/fogLos';
import { useFirstPersonStore } from './firstPersonStore';
import { resolveFirstPersonToken } from './resolveFirstPersonToken';
import { useSessionStore } from '@/store/sessionStore';

type LightSnap = { ambient: number; dirs: number[] };
type SceneFog = THREE.Fog | THREE.FogExp2;

/**
 * First-person vision when table fog-of-war is ON:
 * - Sight range matches token vision feet exactly (30 ft DV → 30 ft full light)
 * - Flat bright light through that radius (floor + walls)
 * - Hard pitch-black past the radius
 *
 * Does nothing when fog is off (normal bright FP).
 */
export function FirstPersonVisionFog(_props: { wallHeight: number }) {
  const fpOn = useFirstPersonStore((s) => s.enabled);
  const { scene, camera } = useThree();
  const keyRef = useRef<THREE.PointLight>(null);
  const fillRef = useRef<THREE.PointLight>(null);
  const prevLights = useRef<LightSnap | null>(null);
  const prevFog = useRef<SceneFog | null>(null);
  const ownFog = useRef<THREE.Fog | null>(null);
  const visionOn = useRef(false);
  const forward = useRef(new THREE.Vector3());

  useEffect(() => {
    return () => {
      teardownVision(scene, prevLights, prevFog, ownFog, visionOn);
      if (keyRef.current) keyRef.current.visible = false;
      if (fillRef.current) fillRef.current.visible = false;
    };
  }, [scene]);

  useFrame(() => {
    const key = keyRef.current;
    const fill = fillRef.current;
    const gm = useSessionStore.getState().myRole === 'GM';
    const wantVision = fpOn && isFogOverlayVisible() && !gm;

    if (!wantVision) {
      if (visionOn.current) {
        teardownVision(scene, prevLights, prevFog, ownFog, visionOn);
      }
      if (key) key.visible = false;
      if (fill) fill.visible = false;
      return;
    }

    if (!visionOn.current) {
      applyVision(scene, prevLights, prevFog, ownFog, visionOn);
    }

    const token = resolveFirstPersonToken();
    const map = getActiveMap();
    if (!token || !map || !key || !fill) {
      if (key) key.visible = false;
      if (fill) fill.visible = false;
      return;
    }

    const grid = map.gridSize || 96;
    // Exact feet→pixels: visionRadius 6 → 30 ft → 6 * grid.
    const radiusPx = fpVisionRadiusPx(token, grid);
    const dv = hasDarkvision(token);

    // Flat illumination to the sight edge (no 1/d² muddying inside the radius).
    key.visible = true;
    key.position.copy(camera.position);
    key.distance = radiusPx;
    key.decay = 0;
    key.intensity = dv ? 2.4 : 2.8;
    key.color.set(dv ? '#f4f7ff' : '#ffd9a0');

    forward.current.set(0, 0, -1).applyQuaternion(camera.quaternion);
    fill.visible = true;
    fill.position.copy(camera.position).addScaledVector(forward.current, grid * 0.25);
    fill.position.y = camera.position.y * 0.5;
    fill.distance = radiusPx;
    fill.decay = 0;
    fill.intensity = dv ? 0.9 : 1.1;
    fill.color.set(dv ? '#eef2fa' : '#ffc078');

    const fog = ownFog.current;
    if (fog) {
      // Full clear through the vision radius, then hard pitch black.
      fog.near = radiusPx * 0.98;
      fog.far = radiusPx;
      fog.color.set('#000000');
      if (scene.fog !== fog) scene.fog = fog;
    }
    if (!(scene.background instanceof THREE.Color) || scene.background.getHex() !== 0x000000) {
      scene.background = new THREE.Color('#000000');
    }
  });

  if (!fpOn) return null;

  return (
    <>
      <pointLight
        ref={keyRef}
        visible={false}
        castShadow={false}
        intensity={2.8}
        distance={400}
        decay={0}
        color="#ffd9a0"
      />
      <pointLight
        ref={fillRef}
        visible={false}
        castShadow={false}
        intensity={1.1}
        distance={400}
        decay={0}
        color="#ffc078"
      />
    </>
  );
}

function applyVision(
  scene: THREE.Scene,
  prevLights: { current: LightSnap | null },
  prevFog: { current: SceneFog | null },
  ownFog: { current: THREE.Fog | null },
  visionOn: { current: boolean },
) {
  if (!prevLights.current) {
    const dirs: number[] = [];
    let ambient = 1;
    scene.traverse((o) => {
      if (o instanceof THREE.AmbientLight) {
        ambient = o.intensity;
        o.intensity = 0;
      }
      if (o instanceof THREE.DirectionalLight || o instanceof THREE.HemisphereLight) {
        dirs.push(o.intensity);
        o.intensity = 0;
      }
    });
    prevLights.current = { ambient, dirs };
  }

  if (
    !prevFog.current
    && scene.fog
    && (scene.fog instanceof THREE.Fog || scene.fog instanceof THREE.FogExp2)
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
) {
  if (prevLights.current) {
    let di = 0;
    scene.traverse((o) => {
      if (o instanceof THREE.AmbientLight) o.intensity = prevLights.current!.ambient;
      if (o instanceof THREE.DirectionalLight || o instanceof THREE.HemisphereLight) {
        const v = prevLights.current!.dirs[di++];
        if (v != null) o.intensity = v;
      }
    });
    prevLights.current = null;
  }
  if (ownFog.current && scene.fog === ownFog.current) {
    scene.fog = prevFog.current;
  }
  prevFog.current = null;
  scene.background = new THREE.Color('#1e1e22');
  visionOn.current = false;
}
