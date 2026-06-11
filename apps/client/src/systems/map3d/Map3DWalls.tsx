import { useMemo } from 'react';
import type { MapItem } from '@/systems/scene/types';
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
  const walls = useMemo(
    () => extrudeWallSegments(map.walls, map.x, map.y, wallHeight, wallThickness),
    [map.walls, map.x, map.y, wallHeight, wallThickness],
  );

  if (walls.length === 0) return null;

  return (
    <group>
      {walls.map((w) => (
        <mesh key={w.key} position={w.position} rotation={[0, w.rotationY, 0]} castShadow receiveShadow>
          <boxGeometry args={w.size} />
          <meshStandardMaterial color="#5c4033" roughness={0.85} metalness={0.08} />
        </mesh>
      ))}
    </group>
  );
}
