import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { normalizeDieSides } from './dieGeometry';

export type SpaceDieKind = 4 | 6 | 8 | 10 | 12 | 20;

const KINDS: SpaceDieKind[] = [4, 6, 8, 10, 12, 20];

/** MotazCG “space low poly dice” — geometry only; colours/numbers stay on our skins. */
const SPACE_DIE_URL: Record<SpaceDieKind, string> = {
  4: '/dice/space/d4.obj',
  6: '/dice/space/d6.obj',
  8: '/dice/space/d8.obj',
  10: '/dice/space/d10.obj',
  12: '/dice/space/d12.obj',
  20: '/dice/space/d20.obj',
};

/** Match the previous procedural dice bounding sizes. */
const TARGET_SIZE: Record<SpaceDieKind, number> = {
  4: 1.04,
  6: 0.72,
  8: 1.12,
  10: 1.0,
  12: 1.0,
  20: 1.04,
};

const cache = new Map<SpaceDieKind, THREE.BufferGeometry>();
let loadPromise: Promise<void> | null = null;

function extractGeometry(root: THREE.Object3D): THREE.BufferGeometry | null {
  let found: THREE.BufferGeometry | null = null;
  root.traverse((child) => {
    if (found) return;
    const mesh = child as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) found = mesh.geometry;
  });
  return found;
}

function prepareGeometry(geo: THREE.BufferGeometry, kind: SpaceDieKind): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.deleteAttribute('uv');
  g.deleteAttribute('uv2');
  g.computeBoundingBox();
  const box = g.boundingBox ?? new THREE.Box3().setFromBufferAttribute(
    g.getAttribute('position') as THREE.BufferAttribute,
  );
  const size = new THREE.Vector3();
  box.getSize(size);
  const longest = Math.max(size.x, size.y, size.z) || 1;
  g.scale(TARGET_SIZE[kind] / longest, TARGET_SIZE[kind] / longest, TARGET_SIZE[kind] / longest);
  g.center();
  g.computeVertexNormals();
  return g;
}

export function preloadSpaceDice(): Promise<void> {
  if (loadPromise) return loadPromise;
  const loader = new OBJLoader();
  loadPromise = Promise.all(
    KINDS.map(async (kind) => {
      const root = await loader.loadAsync(SPACE_DIE_URL[kind]);
      const geo = extractGeometry(root);
      if (!geo) return;
      cache.set(kind, prepareGeometry(geo, kind));
    }),
  ).then(() => undefined);
  return loadPromise;
}

export function spaceDieGeometry(sides: number): THREE.BufferGeometry | null {
  const kind = normalizeDieSides(sides);
  const geo = cache.get(kind);
  return geo ? geo.clone() : null;
}

export function useSpaceDiceReady(): boolean {
  const [ready, setReady] = useState(() => cache.size >= KINDS.length);
  useEffect(() => {
    if (cache.size >= KINDS.length) {
      setReady(true);
      return;
    }
    void preloadSpaceDice().then(() => setReady(cache.size > 0));
  }, []);
  return ready;
}
