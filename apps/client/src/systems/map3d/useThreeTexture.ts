import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { isDdbHostedImageUrl, proxiedDdbImageUrl } from '@/systems/ddb/ddbImageUrl';

async function loadImage(url: string): Promise<HTMLImageElement> {
  const resolved = proxiedDdbImageUrl(url);
  if (isDdbHostedImageUrl(url) || resolved.startsWith('/api/ddb/proxy-image')) {
    const res = await fetch(resolved);
    if (!res.ok) throw new Error(`Texture fetch failed: ${res.status}`);
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = blobUrl;
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    if (!resolved.startsWith('blob:') && !resolved.startsWith('data:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = resolved;
  });
}

/** Load a Three.js texture from the same URLs as the Pixi map renderer. */
export function useThreeTexture(url: string | null | undefined): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!url) {
      setTexture(null);
      return;
    }

    let cancelled = false;
    let current: THREE.Texture | null = null;

    void loadImage(url)
      .then((img) => {
        if (cancelled) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.needsUpdate = true;
        current = tex;
        setTexture(tex);
      })
      .catch(() => {
        if (!cancelled) setTexture(null);
      });

    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [url]);

  return texture;
}
