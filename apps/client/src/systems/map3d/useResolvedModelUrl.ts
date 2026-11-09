import { useEffect, useState } from 'react';
import { isGrimoireModelRef, resolveModelAssetUrl, parseGrimoireModelRef } from '@/lib/modelAssetStore';

/** Session cache — blob URLs stay alive across component remounts (2D/3D toggle). */
const blobCache = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
const packProbe = new Map<string, boolean>();
const packProbeInflight = new Map<string, Promise<boolean>>();

function isPackPublicUrl(url: string): boolean {
  return url.startsWith('/maps3d/') || url.startsWith('/props3d/') || url.startsWith('/props/');
}

/** Kenney/KayKit packs are gitignored — don't treat a 404 GLB as a fatal app crash. */
function probePackUrl(url: string): Promise<boolean> {
  const cached = packProbe.get(url);
  if (cached != null) return Promise.resolve(cached);
  const pending = packProbeInflight.get(url);
  if (pending) return pending;
  const run = (async () => {
    try {
      let res = await fetch(url, { method: 'HEAD', cache: 'force-cache' });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: 'GET', cache: 'force-cache' });
      }
      const ok = res.ok;
      packProbe.set(url, ok);
      return ok;
    } catch {
      packProbe.set(url, false);
      return false;
    } finally {
      packProbeInflight.delete(url);
    }
  })();
  packProbeInflight.set(url, run);
  return run;
}

/** Drop cached blob URL so the next resolve re-reads IndexedDB (after auto-rig overwrite). */
export function invalidateModelBlobCache(ref: string): void {
  const prev = blobCache.get(ref);
  if (prev) {
    try {
      URL.revokeObjectURL(prev);
    } catch {
      /* ignore */
    }
    blobCache.delete(ref);
  }
  inflight.delete(ref);
}

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
    if (isGrimoireModelRef(url)) return blobCache.get(url) ?? null;
    if (isPackPublicUrl(url)) return packProbe.get(url) === true ? url : null;
    return url;
  });
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(() => {
    if (!url) return 'idle';
    if (isGrimoireModelRef(url)) return blobCache.has(url) ? 'ready' : 'loading';
    if (isPackPublicUrl(url)) {
      const hit = packProbe.get(url);
      if (hit === true) return 'ready';
      if (hit === false) return 'error';
      return 'loading';
    }
    return 'ready';
  });

  useEffect(() => {
    if (!url) {
      setResolved(null);
      setStatus('idle');
      return;
    }
    if (!isGrimoireModelRef(url)) {
      if (isPackPublicUrl(url)) {
        const hit = packProbe.get(url);
        if (hit === true) {
          setResolved(url);
          setStatus('ready');
          return;
        }
        if (hit === false) {
          setResolved(null);
          setStatus('error');
          return;
        }
        let cancelledPack = false;
        setResolved(null);
        setStatus('loading');
        void probePackUrl(url).then((ok) => {
          if (cancelledPack) return;
          if (ok) {
            setResolved(url);
            setStatus('ready');
          } else {
            setResolved(null);
            setStatus('error');
          }
        });
        return () => {
          cancelledPack = true;
        };
      }
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

  useEffect(() => {
    if (!url || !isGrimoireModelRef(url)) return;
    const parsed = parseGrimoireModelRef(url);
    if (!parsed) return;

    const onReady = (ev: Event) => {
      const detail = (ev as CustomEvent<{ itemId?: string }>).detail;
      if (!detail?.itemId || !parsed.key.endsWith(`:${detail.itemId}`)) return;
      invalidateModelBlobCache(url);
      void loadBlobUrl(url)
        .then((blobUrl) => {
          setResolved(blobUrl);
          setStatus('ready');
        })
        .catch(() => {
          setResolved(null);
          setStatus('error');
        });
    };

    window.addEventListener('grimoire:model-asset-ready', onReady);
    return () => window.removeEventListener('grimoire:model-asset-ready', onReady);
  }, [url]);

  // Players on mobile may join before model chunks arrive — retry IndexedDB resolve.
  useEffect(() => {
    if (!url || !isGrimoireModelRef(url) || status !== 'error') return;
    let cancelled = false;
    let attempts = 0;
    const retry = () => {
      if (cancelled || attempts >= 10) return;
      attempts += 1;
      void loadBlobUrl(url)
        .then((blobUrl) => {
          if (cancelled) return;
          setResolved(blobUrl);
          setStatus('ready');
        })
        .catch(() => {
          if (!cancelled) window.setTimeout(retry, Math.min(1500 * attempts, 8000));
        });
    };
    const timer = window.setTimeout(retry, 600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url, status]);

  return { resolved, status };
}
