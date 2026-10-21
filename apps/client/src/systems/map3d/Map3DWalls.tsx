import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { displayWalls, doorWallsSignature } from '@/systems/map/props/doorCollision';
import { resolveMapSurfaceStyle } from './mapSurfaceStyles';
import { getMapSurfaceTexture, tileSurfaceTexture } from './mapSurfaceTextures';
import { pbrAssetForStyle } from './pbrSurfaceAssets';
import {
  disposePbrSurfaceMaps,
  tilePbrSurfaceMaps,
  usePbrSurfaceMaps,
} from './pbrSurfaceLoader';
import { extrudeWallSegments } from './wallExtrusion';

const WALL_NORMAL_SCALE = new THREE.Vector2(1.38, 1.38);

export function Map3DWalls({
  map,
  wallHeight,
  wallThickness,
}: {
  map: MapItem;
  wallHeight: number;
  wallThickness: number;
}) {
  const items = useItemStore((s) => s.items);
  const wallStyleId = useMapStore((s) => s.wallStyleId);
  const style = resolveMapSurfaceStyle(wallStyleId);
  const doorSig = doorWallsSignature(map, items);
  const displaySegs = useMemo(
    () => displayWalls(map, items),
    [map.walls, doorSig, items],
  );
  const wallCuts = map.wallCuts ?? [];
  const walls = useMemo(() => {
    return extrudeWallSegments(
      displaySegs,
      map.x,
      map.y,
      wallHeight,
      wallThickness,
      wallCuts,
    );
  }, [displaySegs, map.x, map.y, wallHeight, wallThickness, wallCuts]);

  const pbrAssetId = pbrAssetForStyle(style.id, 'wall');
  const { maps: pbrBase } = usePbrSurfaceMaps(pbrAssetId);

  const baseArt = useMemo(
    () => (pbrBase ? null : getMapSurfaceTexture(wallStyleId, 'wall')),
    [wallStyleId, pbrBase],
  );

  const wallTileWorld = Math.max(72, (map.gridSize || 96) * 3.2);

  const wallPbrMats = useMemo(() => {
    if (!pbrBase) return null;
    return walls.map((w) => {
      const [, h, len] = w.size;
      return tilePbrSurfaceMaps(pbrBase, len, h, wallTileWorld);
    });
  }, [pbrBase, walls, wallTileWorld]);

  const wallMats = useMemo(() => {
    if (!baseArt || pbrBase) return null;
    return walls.map((w) => {
      const [, h, len] = w.size;
      return tileSurfaceTexture(baseArt, len, h, wallTileWorld);
    });
  }, [baseArt, pbrBase, walls, wallTileWorld]);

  useEffect(() => () => {
    wallMats?.forEach((t) => t.dispose());
    wallPbrMats?.forEach((m) => disposePbrSurfaceMaps(m));
    for (const w of walls) w.geometry?.dispose();
  }, [wallMats, wallPbrMats, walls]);

  if (walls.length === 0) return null;

  return (
    <group>
      {walls.map((w, i) => (
        <mesh
          key={w.key}
          position={w.position}
          rotation={[0, w.rotationY, 0]}
          castShadow
          receiveShadow
          userData={{
            fpSurface: 'wall',
            mapId: map.id,
            wallIndex: w.wallIndex,
            ax: w.ax,
            ay: w.ay,
            bx: w.bx,
            by: w.by,
          }}
          {...(w.geometry ? { geometry: w.geometry } : {})}
        >
          {!w.geometry && <boxGeometry args={w.size} />}
          {wallPbrMats?.[i] ? (
            <meshStandardMaterial
              map={wallPbrMats[i].map}
              normalMap={wallPbrMats[i].normalMap}
              roughnessMap={wallPbrMats[i].roughnessMap}
              aoMap={wallPbrMats[i].aoMap}
              aoMapIntensity={1.55}
              normalScale={WALL_NORMAL_SCALE}
              color="#ffffff"
              roughness={1}
              metalness={0.06}
              side={THREE.DoubleSide}
            />
          ) : wallMats?.[i] ? (
            <meshStandardMaterial
              map={wallMats[i]}
              color="#ffffff"
              roughness={style.wallRoughness}
              metalness={0.06}
              side={THREE.DoubleSide}
            />
          ) : (
            <meshStandardMaterial
              color={style.wall}
              roughness={style.wallRoughness}
              metalness={0.08}
              side={THREE.DoubleSide}
            />
          )}
        </mesh>
      ))}
    </group>
  );
}
