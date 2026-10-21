import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { polyHavenJpgUrl } from './pbrSurfaceAssets';

export interface PbrSurfaceMaps {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap: THREE.Texture;
}

const loader = new THREE.TextureLoader();
loader.setCrossOrigin('anonymous');

const cache = new Map<string, Promise<PbrSurfaceMaps>>();

let whiteAo: THREE.Texture | null = null;
function fallbackAoMap(): THREE.Texture {
  if (!whiteAo) {
    const data = new Uint8Array([255, 255, 255]);
    whiteAo = new THREE.DataTexture(data, 1, 1, THREE.RGBFormat);
    whiteAo.needsUpdate = true;
    configureTile(whiteAo, false);
  }
  return whiteAo;
}

async function loadOptionalAo(assetId: string): Promise<THREE.Texture> {
  try {
    const aoMap = await loader.loadAsync(polyHavenJpgUrl(assetId, 'ao'));
    return configureTile(aoMap, false);
  } catch {
    return fallbackAoMap();
  }
}

function configureTile(t: THREE.Texture, srgb: boolean): THREE.Texture {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 16;
  t.needsUpdate = true;
  return t;
}

export function loadPbrSurfaceMaps(assetId: string): Promise<PbrSurfaceMaps> {
  const existing = cache.get(assetId);
  if (existing) return existing;

  const job = (async () => {
    try {
      const [map, normalMap, roughnessMap, aoMap] = await Promise.all([
        loader.loadAsync(polyHavenJpgUrl(assetId, 'diff')),
        loader.loadAsync(polyHavenJpgUrl(assetId, 'nor_gl')),
        loader.loadAsync(polyHavenJpgUrl(assetId, 'rough')),
        loadOptionalAo(assetId),
      ]);
      configureTile(map, true);
      configureTile(normalMap, false);
      configureTile(roughnessMap, false);
      return { map, normalMap, roughnessMap, aoMap };
    } catch (err) {
      cache.delete(assetId);
      throw err;
    }
  })();

  cache.set(assetId, job);
  return job;
}

/** Clone all maps with matching world repeat (dispose clones when done). */
export function tilePbrSurfaceMaps(
  base: PbrSurfaceMaps,
  worldW: number,
  worldH: number,
  tileWorld: number,
): PbrSurfaceMaps {
  const rx = Math.max(0.35, worldW / tileWorld);
  const ry = Math.max(0.35, worldH / tileWorld);
  const clone = (t: THREE.Texture) => {
    const c = t.clone();
    c.wrapS = THREE.RepeatWrapping;
    c.wrapT = THREE.RepeatWrapping;
    c.colorSpace = t.colorSpace;
    c.repeat.set(rx, ry);
    c.anisotropy = t.anisotropy;
    c.needsUpdate = true;
    return c;
  };
  return {
    map: clone(base.map),
    normalMap: clone(base.normalMap),
    roughnessMap: clone(base.roughnessMap),
    aoMap: clone(base.aoMap),
  };
}

export function disposePbrSurfaceMaps(m: PbrSurfaceMaps | null | undefined): void {
  if (!m) return;
  m.map.dispose();
  m.normalMap.dispose();
  m.roughnessMap.dispose();
  m.aoMap.dispose();
}

export function usePbrSurfaceMaps(assetId: string | null): {
  maps: PbrSurfaceMaps | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
} {
  const [maps, setMaps] = useState<PbrSurfaceMaps | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!assetId) {
      setMaps(null);
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    void loadPbrSurfaceMaps(assetId)
      .then((loaded) => {
        if (cancelled) return;
        setMaps(loaded);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setMaps(null);
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  return { maps, status };
}
