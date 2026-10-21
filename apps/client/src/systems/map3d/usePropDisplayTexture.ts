import { useEffect, useState } from 'react';
import * as THREE from 'three';
import type { ImageItem } from '@/systems/scene/types';
import { resolvePropId } from '@/systems/map/props/dungeonProps';
import { propArtById } from '@/systems/map/props/propArt';
import { getPropCanvasTexture, hasPropCanvasArt } from '@/systems/map/props/propCanvasArt';
import { loadImageUrl } from '@/lib/textureLoader';

function canvasToThree(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  const w = canvas.width;
  const h = canvas.height;
  if (w >= 8 && h >= 8) {
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
  } else {
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearFilter;
  }
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

/** Same art source as Pixi props (catalog rest URL, item image, or HQ canvas). */
export function resolvePropDisplayImageUrl(
  item: ImageItem,
  propId?: string,
): string | null {
  const raw = item.imageUrl?.trim();
  if (raw && !raw.startsWith('data:image/svg')) return raw;
  const id = propId ?? resolvePropId(item);
  if (id && hasPropCanvasArt(id)) return null;
  if (id) {
    const art = propArtById(id);
    if (art?.rest) return art.rest;
  }
  return raw || null;
}

/** Load the 2D prop sprite into a Three.js texture (canvas art or PNG/SVG). */
export function usePropDisplayTexture(
  item: ImageItem,
  propId: string | undefined,
): {
  texture: THREE.Texture | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
} {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    let current: THREE.Texture | null = null;

    const finish = (tex: THREE.Texture | null, st: typeof status) => {
      if (cancelled) {
        tex?.dispose();
        return;
      }
      current = tex;
      setTexture(tex);
      setStatus(st);
    };

    if (propId && hasPropCanvasArt(propId)) {
      setStatus('loading');
      const pixi = getPropCanvasTexture(propId);
      const resource = pixi?.source?.resource;
      if (resource instanceof HTMLCanvasElement) {
        finish(canvasToThree(resource), 'ready');
      } else {
        finish(null, 'error');
      }
      return () => {
        cancelled = true;
        current?.dispose();
      };
    }

    const url = resolvePropDisplayImageUrl(item, propId);
    if (!url) {
      finish(null, 'idle');
      return () => {
        cancelled = true;
        current?.dispose();
      };
    }

    setStatus('loading');
    void loadImageUrl(url)
      .then((img) => {
        if (cancelled) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.magFilter = THREE.LinearFilter;
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        if (w >= 8 && h >= 8) {
          tex.generateMipmaps = true;
          tex.minFilter = THREE.LinearMipmapLinearFilter;
        } else {
          tex.generateMipmaps = false;
          tex.minFilter = THREE.LinearFilter;
        }
        tex.needsUpdate = true;
        finish(tex, 'ready');
      })
      .catch(() => finish(null, 'error'));

    return () => {
      cancelled = true;
      current?.dispose();
    };
  }, [item.id, item.imageUrl, propId]);

  return { texture, status };
}
