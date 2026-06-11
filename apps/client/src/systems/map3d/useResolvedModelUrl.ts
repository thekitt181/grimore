import { useEffect, useState } from 'react';
import { isGrimoireModelRef, resolveModelAssetUrl } from '@/lib/modelAssetStore';

/** Resolve grimoire-model:// refs to blob URLs for Three.js loaders. */
export function useResolvedModelUrl(url: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<string | null>(() =>
    url && !isGrimoireModelRef(url) ? url : null,
  );

  useEffect(() => {
    if (!url) {
      setResolved(null);
      return;
    }
    if (!isGrimoireModelRef(url)) {
      setResolved(url);
      return;
    }

    let blobUrl: string | null = null;
    let cancelled = false;
    void resolveModelAssetUrl(url)
      .then((u) => {
        if (cancelled) {
          URL.revokeObjectURL(u);
          return;
        }
        blobUrl = u;
        setResolved(u);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  return resolved;
}
