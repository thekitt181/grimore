import { useEffect, useState } from 'react';
import type { MapItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import { getApiBaseUrl } from '@/lib/appUrls';
import {
  scanMapImageForScene,
  sceneScanCacheKey,
  type MapSceneScanResult,
} from './mapImageSceneScan';

const scanCache = new Map<string, MapSceneScanResult>();
const inflightScans = new Map<string, Promise<MapSceneScanResult | null>>();

type ScanApiResponse = MapSceneScanResult & {
  wallCells: number[];
  meta?: { method: 'cubicasa' | 'cv'; fallback?: boolean };
};

type FloorplanScanMeta = { method: 'cubicasa' | 'cv'; fallback?: boolean };

async function scanMapViaServer(
  map: MapItem,
  threshold: number,
): Promise<{ scene: MapSceneScanResult; meta: FloorplanScanMeta } | null> {
  if (!map.backgroundUrl) return null;

  const res = await fetch(`${getApiBaseUrl()}/maps/floorplan-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      backgroundUrl: map.backgroundUrl,
      width: map.width,
      height: map.height,
      gridSize: map.gridSize,
      gridOffsetX: map.gridOffsetX ?? 0,
      gridOffsetY: map.gridOffsetY ?? 0,
      x: map.x,
      y: map.y,
      threshold,
    }),
  });

  if (!res.ok) {
    throw new Error(`Scan failed (${res.status})`);
  }

  const data = (await res.json()) as ScanApiResponse;
  const scene: MapSceneScanResult = {
    cols: data.cols,
    rows: data.rows,
    wallCells: Uint8Array.from(data.wallCells),
    wallSegments: data.wallSegments,
    doors: data.doors,
    wallCellCount: data.wallCellCount,
    props: data.props ?? [],
    waters: data.waters ?? [],
    stairs: data.stairs ?? [],
    pits: data.pits ?? [],
    featureCount: data.featureCount,
  };
  return { scene, meta: data.meta ?? { method: 'cv' } };
}

export function useImageSceneScan(map: MapItem | null) {
  const scanImageWalls = useMapStore((s) => s.scanImageWalls);
  const wallScanThreshold = useMapStore((s) => s.wallScanThreshold);
  const [result, setResult] = useState<MapSceneScanResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'scanning' | 'ready' | 'error'>('idle');
  const [scanMethod, setScanMethod] = useState<'cubicasa' | 'cv' | null>(null);
  const [scanToken, setScanToken] = useState(0);

  useEffect(() => {
    if (!map?.backgroundUrl || !scanImageWalls) {
      setResult(null);
      setStatus('idle');
      setScanMethod(null);
      return;
    }

    const key = sceneScanCacheKey(map, wallScanThreshold, 'cubicasa');
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
      const promise = scanMapViaServer(map, wallScanThreshold)
        .catch(() => null)
        .then(async (serverResult) => {
          if (serverResult?.scene && serverResult.scene.featureCount > 0) {
            return serverResult;
          }
          const scene = await scanMapImageForScene(map, { threshold: wallScanThreshold });
          return scene ? { scene, meta: { method: 'cv' as const } } : null;
        })
        .then((payload) => {
          if (payload?.scene && payload.scene.featureCount > 0) {
            scanCache.set(key, payload.scene);
          }
          return payload;
        })
        .finally(() => {
          inflightScans.delete(key);
        });
      inflightScans.set(key, promise);
      return promise;
    };

    void run()
      .then((payload) => {
        if (cancelled) return;
        setResult(payload?.scene ?? null);
        setScanMethod(payload?.meta.method ?? null);
        setStatus(payload?.scene ? 'ready' : 'error');
      })
      .catch(() => {
        if (!cancelled) {
          setResult(null);
          setStatus('error');
          setScanMethod(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [map, scanImageWalls, wallScanThreshold, scanToken]);

  return {
    result,
    status,
    scanMethod,
    rescan: () => {
      if (map) {
        const key = sceneScanCacheKey(map, wallScanThreshold, 'cubicasa');
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
