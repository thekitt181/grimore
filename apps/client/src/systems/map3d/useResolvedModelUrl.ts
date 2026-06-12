import { useEffect, useState } from 'react';
import { isGrimoireModelRef, resolveModelAssetUrl } from '@/lib/modelAssetStore';

type CachedBlob = { blobUrl: string; refs: number };
const blobCache = new Map<string, CachedBlob>();

function retainBlobUrl(ref: string, blobUrl: string): void {
  const existing = blobCache.get(ref);
  if (existing) {
    existing.refs += 1;
    return;
  }
  blobCache.set(ref, { blobUrl, refs: 1 });
}

function releaseBlobUrl(ref: string): void {
  const entry = blobCache.get(ref);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs <= 0) {
    URL.revokeObjectURL(entry.blobUrl);
    blobCache.delete(ref);
  }
}

/** Resolve grimoire-model:// refs to blob URLs for Three.js loaders. */
export function useResolvedModelUrl(url: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(() => {
    if (!url) return null;
    if (!isGrimoireModelRef(url)) return url;
    return blobCache.get(url)?.blobUrl ?? null;
  });

  useEffect(() => {
    if (!url) {
      setResolved(null);
      return;
    }
    if (!isGrimoireModelRef(url)) {
      setResolved(url);
      return;
    }

    let cancelled = false;
    const cached = blobCache.get(url);
    if (cached) {
      retainBlobUrl(url, cached.blobUrl);
      setResolved(cached.blobUrl);
      return () => {
        releaseBlobUrl(url);
      };
    }

    void resolveModelAssetUrl(url)
      .then((blobUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(blobUrl);
          return;
        }
        retainBlobUrl(url, blobUrl);
        setResolved(blobUrl);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });

    return () => {
      cancelled = true;
      releaseBlobUrl(url);
    };
  }, [url]);

  return resolved;
}
