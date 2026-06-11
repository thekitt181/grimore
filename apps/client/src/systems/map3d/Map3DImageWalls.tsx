import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import type { WallCellGrid } from './mapImageWallScan';
import { useImageWallScan } from './useImageWallScan';

function VoxelWallInstances({
  map,
  grid,
  wallHeight,
}: {
  map: MapItem;
  grid: WallCellGrid;
  wallHeight: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const gridSize = map.gridSize;
  const cellSize = gridSize * 0.92;

  const instanceData = useMemo(() => {
    const positions: THREE.Vector3[] = [];
    const ox = map.x + map.gridOffsetX;
    const oz = map.y + map.gridOffsetY;

    for (let cy = 0; cy < grid.rows; cy++) {
      for (let cx = 0; cx < grid.cols; cx++) {
        if (!grid.cells[cy * grid.cols + cx]) continue;
        positions.push(
          new THREE.Vector3(
            ox + cx * gridSize + gridSize / 2,
            wallHeight / 2,
            oz + cy * gridSize + gridSize / 2,
          ),
        );
      }
    }
    return positions;
  }, [grid, map.x, map.y, map.gridOffsetX, map.gridOffsetY, gridSize, wallHeight]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const tmp = new THREE.Object3D();
    for (let i = 0; i < instanceData.length; i++) {
      const pos = instanceData[i]!;
      tmp.position.copy(pos);
      tmp.rotation.set(0, 0, 0);
      tmp.scale.set(1, 1, 1);
      tmp.updateMatrix();
      mesh.setMatrixAt(i, tmp.matrix);
    }
    mesh.count = instanceData.length;
    mesh.instanceMatrix.needsUpdate = true;
  }, [instanceData]);

  if (instanceData.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, instanceData.length]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[cellSize, wallHeight, cellSize]} />
      <meshStandardMaterial color="#1a1410" roughness={0.88} metalness={0.06} />
    </instancedMesh>
  );
}

/** Scan map art for dark walls and extrude matching voxel columns. */
export function Map3DImageWalls({ map, wallHeight }: { map: MapItem; wallHeight: number }) {
  const { result } = useImageWallScan(map);
  if (!result || result.wallCellCount === 0) return null;

  return <VoxelWallInstances map={map} grid={result} wallHeight={wallHeight} />;
}
