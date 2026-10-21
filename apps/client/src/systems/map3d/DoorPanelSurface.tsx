import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { resolveMapSurfaceStyle } from './mapSurfaceStyles';
import { getMapSurfaceTexture, tileSurfaceTexture } from './mapSurfaceTextures';
import { getDoorPanelTexture } from './doorSurfaceTextures';
import { doorPbrAssetId, doorTextureSpec } from './doorPbrAssets';
import { resolveDoorSurfaceStyle } from './doorSurfaceStyles';
import {
  disposePbrSurfaceMaps,
  tilePbrSurfaceMaps,
  usePbrSurfaceMaps,
  type PbrSurfaceMaps,
} from './pbrSurfaceLoader';

const WALL_NORMAL_SCALE = new THREE.Vector2(1.38, 1.38);

/** Door panel — door-theme PBR (wood / metal / barred) or wall-matched stone. */
export function DoorPanelSurface({
  doorStyleId,
  faceUnitW,
  faceUnitH,
  faceWorldW,
  faceWorldH,
  doubleSided = true,
  tileWorld: tileWorldProp,
}: {
  doorStyleId: string;
  faceUnitW: number;
  faceUnitH: number;
  faceWorldW: number;
  faceWorldH: number;
  doubleSided?: boolean;
  tileWorld?: number;
}) {
  const wallStyleId = useMapStore((s) => s.wallStyleId);
  const mapGridSize = useMapStore((s) => s.gridSize);
  const tileWorld = tileWorldProp ?? Math.max(72, (mapGridSize || 96) * 3.2);
  const theme = resolveDoorSurfaceStyle(doorStyleId);
  const spec = doorTextureSpec(doorStyleId);
  const pbrAssetId = doorPbrAssetId(doorStyleId, wallStyleId);
  const { maps: pbrBase, status: pbrStatus } = usePbrSurfaceMaps(pbrAssetId);

  const wallArt = useMemo(() => {
    if (spec.family !== 'wall') return null;
    return getMapSurfaceTexture(wallStyleId, 'wall');
  }, [spec.family, wallStyleId]);

  const doorArt = useMemo(() => {
    if (pbrBase) return null;
    return getDoorPanelTexture(doorStyleId);
  }, [doorStyleId, pbrBase]);

  const baseArt = useMemo(() => {
    if (pbrBase) return null;
    return doorArt ?? wallArt;
  }, [pbrBase, doorArt, wallArt]);

  const pbrTiled = useMemo((): PbrSurfaceMaps | null => {
    if (!pbrBase) return null;
    return tilePbrSurfaceMaps(pbrBase, faceWorldW, faceWorldH, tileWorld);
  }, [pbrBase, faceWorldW, faceWorldH, tileWorld]);

  const artTiled = useMemo(() => {
    if (!baseArt || pbrBase) return null;
    return tileSurfaceTexture(baseArt, faceWorldW, faceWorldH, tileWorld);
  }, [baseArt, pbrBase, faceWorldW, faceWorldH, tileWorld]);

  useEffect(
    () => () => {
      artTiled?.dispose();
      if (pbrTiled) disposePbrSurfaceMaps(pbrTiled);
    },
    [artTiled, pbrTiled],
  );

  const matSide = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  const wallStyle = resolveMapSurfaceStyle(wallStyleId);
  const roughFallback = spec.family === 'metal' || spec.family === 'barred' ? 0.72 : theme.panel ? 0.82 : wallStyle.wallRoughness;

  void pbrStatus;

  return (
    <>
      <planeGeometry args={[faceUnitW, faceUnitH]} />
      {pbrTiled ? (
        <meshStandardMaterial
          map={pbrTiled.map}
          normalMap={pbrTiled.normalMap}
          roughnessMap={pbrTiled.roughnessMap}
          aoMap={pbrTiled.aoMap}
          aoMapIntensity={1.55}
          normalScale={WALL_NORMAL_SCALE}
          color="#ffffff"
          roughness={1}
          metalness={spec.family === 'metal' || spec.family === 'barred' ? 0.35 : 0.06}
          side={matSide}
        />
      ) : artTiled ? (
        <meshStandardMaterial
          map={artTiled}
          color="#ffffff"
          roughness={roughFallback}
          metalness={spec.family === 'metal' ? 0.28 : 0.06}
          side={matSide}
        />
      ) : (
        <meshStandardMaterial
          color={theme.panel}
          roughness={roughFallback}
          metalness={0.08}
          side={matSide}
        />
      )}
    </>
  );
}
