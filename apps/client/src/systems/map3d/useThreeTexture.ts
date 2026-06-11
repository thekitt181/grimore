import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { loadImageUrl } from '@/lib/textureLoader';

/** Load a Three.js texture from the same URLs (and cache) as the Pixi map renderer. */
export function useThreeTexture(url: string | null | undefined): {
  texture: THREE.Texture | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
} {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    if (!url) {
      setTexture(null);
      setStatus('idle');
      return;
    }

    let cancelled = false;
    let current: THREE.Texture | null = null;
    setStatus('loading');

    void loadImageUrl(url)
      .then((img) => {
        if (cancelled) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        current = tex;
        setTexture(tex);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setTexture(null);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [url]);

  return { texture, status };
}
