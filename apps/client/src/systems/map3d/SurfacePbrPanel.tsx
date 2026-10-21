import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useMapStore } from '@/systems/map/store/mapStore';
import { resolveMapSurfaceStyle } from './mapSurfaceStyles';
import { getMapSurfaceTexture, tileSurfaceTexture } from './mapSurfaceTextures';
import { pbrAssetForStyle } from './pbrSurfaceAssets';
import {
  disposePbrSurfaceMaps,
  tilePbrSurfaceMaps,
  usePbrSurfaceMaps,
  type PbrSurfaceMaps,
} from './pbrSurfaceLoader';

const WALL_NORMAL_SCALE = new THREE.Vector2(1.38, 1.38);

/** Tiled wall PBR / procedural art on a plane (doors, panels flush with extruded walls). */
export function SurfacePbrPanel({
  faceUnitW,
  faceUnitH,
  faceWorldW,
  faceWorldH,
  tintColor = '#ffffff',
  wallStyleId: wallStyleOverride,
  doubleSided = false,
  tileWorld: tileWorldProp,
}: {
  faceUnitW: number;
  faceUnitH: number;
  faceWorldW: number;
  faceWorldH: number;
  /** Multiplies the albedo map (door theme tint). */
  tintColor?: string;
  wallStyleId?: string;
  /** Doors — visible from either side of the wall (match Map3DWalls). */
  doubleSided?: boolean;
  tileWorld?: number;
}) {
  const wallStyleId = wallStyleOverride ?? useMapStore((s) => s.wallStyleId);
  const mapGridSize = useMapStore((s) => s.gridSize);
  const tileWorld = tileWorldProp ?? Math.max(72, (mapGridSize || 96) * 3.2);
  const style = resolveMapSurfaceStyle(wallStyleId);
  const pbrAssetId = pbrAssetForStyle(style.id, 'wall');
  const { maps: pbrBase, status: pbrStatus } = usePbrSurfaceMaps(pbrAssetId);

  const baseArt = useMemo(() => {
    if (pbrBase) return null;
    if (pbrAssetId && pbrStatus === 'loading') return getMapSurfaceTexture(wallStyleId, 'wall');
    if (pbrAssetId && pbrStatus === 'ready') return null;
    return getMapSurfaceTexture(wallStyleId, 'wall');
  }, [wallStyleId, pbrBase, pbrAssetId, pbrStatus]);

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
          color={tintColor}
          roughness={1}
          metalness={0.04}
          side={matSide}
        />
      ) : artTiled ? (
        <meshStandardMaterial
          map={artTiled}
          color={tintColor}
          roughness={style.wallRoughness}
          metalness={0.06}
          side={matSide}
        />
      ) : (
        <meshStandardMaterial
          color={style.wall}
          roughness={style.wallRoughness}
          metalness={0.08}
          side={matSide}
        />
      )}
    </>
  );
}
