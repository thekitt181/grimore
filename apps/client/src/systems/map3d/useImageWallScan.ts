import { useEffect, useState } from 'react';
import type { MapItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  scanMapImageForScene,
  sceneScanCacheKey,
  type MapSceneScanResult,
} from './mapImageSceneScan';

const scanCache = new Map<string, MapSceneScanResult>();
const inflightScans = new Map<string, Promise<MapSceneScanResult | null>>();

export function useImageSceneScan(map: MapItem | null) {
  const scanImageWalls = useMapStore((s) => s.scanImageWalls);
  const wallScanThreshold = useMapStore((s) => s.wallScanThreshold);
  const [result, setResult] = useState<MapSceneScanResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
  const [scanToken, setScanToken] = useState(0);

  useEffect(() => {
    if (!map?.backgroundUrl || !scanImageWalls) {
      setResult(null);
      setStatus('idle');
      return;
    }

    const key = sceneScanCacheKey(map, wallScanThreshold);
    const cached = scanCache.get(key);
    if (cached && scanToken === 0) {
      setResult(cached);
      setStatus('ready');
      return;
    }

    let cancelled = false;
    setStatus('scanning');

    const run = () => {
      const pending = inflightScans.get(key);
      if (pending) return pending;
      const promise = scanMapImageForScene(map, { threshold: wallScanThreshold })
        .then((scene) => {
          if (scene && scene.featureCount > 0) scanCache.set(key, scene);
          return scene;
        })
        .finally(() => {
          inflightScans.delete(key);
        });
      inflightScans.set(key, promise);
      return promise;
    };

    void run()
      .then((scene) => {
        if (cancelled) return;
        setResult(scene);
        setStatus(scene ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) {
          setResult(null);
          setStatus('error');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [map, scanImageWalls, wallScanThreshold, scanToken]);

  return {
    result,
    status,
    rescan: () => {
      if (map) {
        const key = sceneScanCacheKey(map, wallScanThreshold);
        scanCache.delete(key);
        inflightScans.delete(key);
      }
      setScanToken((n) => n + 1);
    },
  };
}

/** @deprecated Use useImageSceneScan */
export const useImageWallScan = useImageSceneScan;

export type { MapSceneScanResult as MapWallScanResult };
