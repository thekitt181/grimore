import { useMemo, useEffect } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import { displayWalls, doorWallsSignature } from '@/systems/map/props/doorCollision';
import { resolveMapSurfaceStyle } from './mapSurfaceStyles';
import { getMapSurfaceTexture, tileSurfaceTexture } from './mapSurfaceTextures';
import { extrudeWallSegments } from './wallExtrusion';

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

  const baseArt = useMemo(
    () => getMapSurfaceTexture(wallStyleId, 'wall'),
    [wallStyleId],
  );

  const wallMats = useMemo(() => {
    if (!baseArt) return null;
    return walls.map((w) => {
      const [, h, len] = w.size;
      return tileSurfaceTexture(baseArt, len, h, (map.gridSize || 96) * 0.85);
    });
  }, [baseArt, walls, map.gridSize]);

  useEffect(() => () => {
    wallMats?.forEach((t) => t.dispose());
    for (const w of walls) w.geometry?.dispose();
  }, [wallMats, walls]);

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
          {wallMats?.[i] ? (
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
