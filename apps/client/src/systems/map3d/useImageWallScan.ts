import { useEffect, useState } from 'react';
import type { MapItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import {
  scanMapImageForWalls,
  wallScanCacheKey,
  type MapWallScanResult,
} from './mapImageWallScan';

const scanCache = new Map<string, MapWallScanResult>();
const inflightScans = new Map<string, Promise<MapWallScanResult | null>>();

export function useImageWallScan(map: MapItem | null) {
  const scanImageWalls = useMapStore((s) => s.scanImageWalls);
  const wallScanThreshold = useMapStore((s) => s.wallScanThreshold);
  const [result, setResult] = useState<MapWallScanResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
  const [scanToken, setScanToken] = useState(0);

  useEffect(() => {
    if (!map?.backgroundUrl || !scanImageWalls) {
      setResult(null);
      setStatus('idle');
      return;
    }

    const key = wallScanCacheKey(map, wallScanThreshold);
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
      const promise = scanMapImageForWalls(map, { threshold: wallScanThreshold })
        .then((grid) => {
          if (grid && grid.wallCellCount > 0) scanCache.set(key, grid);
          return grid;
        })
        .finally(() => {
          inflightScans.delete(key);
        });
      inflightScans.set(key, promise);
      return promise;
    };

    void run()
      .then((grid) => {
        if (cancelled) return;
        setResult(grid);
        setStatus(grid ? 'ready' : 'error');
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
        const key = wallScanCacheKey(map, wallScanThreshold);
        scanCache.delete(key);
        inflightScans.delete(key);
      }
      setScanToken((n) => n + 1);
    },
  };
}
