import { useEffect, useState } from 'react';
import { isGrimoireModelRef, resolveModelAssetUrl } from '@/lib/modelAssetStore';

/** Session cache — blob URLs stay alive across component remounts (2D/3D toggle). */
const blobCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();

function loadBlobUrl(ref: string): Promise<string> {
  const cached = blobCache.get(ref);
  if (cached) return Promise.resolve(cached);

  const pending = inflight.get(ref);
  if (pending) return pending;

  const promise = resolveModelAssetUrl(ref)
    .then((blobUrl) => {
      blobCache.set(ref, blobUrl);
      inflight.delete(ref);
      return blobUrl;
    })
    .catch((err) => {
      inflight.delete(ref);
      throw err;
    });

  inflight.set(ref, promise);
  return promise;
}

/** Resolve grimoire-model:// refs to blob URLs for Three.js loaders. */
export function useResolvedModelUrl(url: string | null | undefined): {
  resolved: string | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
} {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!url) return null;
    if (!isGrimoireModelRef(url)) return url;
    return blobCache.get(url) ?? null;
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => {
    if (!url) return 'idle';
    if (!isGrimoireModelRef(url)) return 'ready';
    return blobCache.has(url) ? 'ready' : 'loading';
  });

  useEffect(() => {
    if (!url) {
      setResolved(null);
      setStatus('idle');
      return;
    }
    if (!isGrimoireModelRef(url)) {
      setResolved(url);
      setStatus('ready');
      return;
    }

    const cached = blobCache.get(url);
    if (cached) {
      setResolved(cached);
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('loading');

    void loadBlobUrl(url)
      .then((blobUrl) => {
        if (cancelled) return;
        setResolved(blobUrl);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setResolved(null);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  return { resolved, status };
}
