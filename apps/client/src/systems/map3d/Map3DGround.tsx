import { useMemo } from 'react';
import type { MapItem } from '@/systems/scene/types';
import { useThreeTexture } from './useThreeTexture';
import { clayMaterialProps } from './clayMaterials';
import { useLiveItemBounds } from './useLiveItemBounds';
import { SceneItemTransformGroup } from './TokenTransformGroup';

export function Map3DGround({
  map,
  clayMode = false,
  skipFloor = false,
}: {
  map: MapItem;
  clayMode?: boolean;
  skipFloor?: boolean;
}) {
  const { texture, status } = useThreeTexture(map.backgroundUrl);
  const { x, y, width, height } = useLiveItemBounds(map);

  const gridLines = useMemo(() => {
    if (!map.showGrid || clayMode) return null;
    const cols = Math.ceil(width / map.gridSize);
    const rows = Math.ceil(height / map.gridSize);
    const points: number[] = [];
    const ox = x + map.gridOffsetX;
    const oz = y + map.gridOffsetY;
    const cx = x + width / 2;
    const cz = y + height / 2;

    for (let c = 0; c <= cols; c++) {
      const wx = ox + c * map.gridSize;
      points.push(wx - cx, 0.02, oz - cz, wx - cx, 0.02, oz + rows * map.gridSize - cz);
    }
    for (let r = 0; r <= rows; r++) {
      const wz = oz + r * map.gridSize;
      points.push(ox - cx, 0.02, wz - cz, ox + cols * map.gridSize - cx, 0.02, wz - cz);
    }
    return new Float32Array(points);
  }, [map, clayMode, x, y, width, height]);

  const gridColor = `#${map.gridColor.toString(16).padStart(6, '0')}`;

  const floorMaterial = clayMode
    ? texture
      ? { map: texture, color: '#ffffff', roughness: 0.94, metalness: 0.01 }
      : clayMaterialProps('floor')
    : texture
      ? { map: texture, color: '#ffffff', roughness: 0.88, metalness: 0.02, emissive: '#ffffff', emissiveIntensity: 0.12 }
      : { color: status === 'error' ? '#3d2020' : '#252532', roughness: 0.92, metalness: 0.02 };

  return (
    <SceneItemTransformGroup itemId={map.id} surfaceY={0} baseWidth={map.width} baseHeight={map.height}>
      {!skipFloor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow={false}>
          <planeGeometry args={[map.width, map.height, 1, 1]} />
          <meshStandardMaterial {...floorMaterial} />
        </mesh>
      )}

      {!skipFloor && !texture && status !== 'loading' && !clayMode && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
          <planeGeometry args={[map.width, map.height]} />
          <meshStandardMaterial color="#252532" wireframe transparent opacity={0.15} />
        </mesh>
      )}

      {gridLines && (
        <lineSegments>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[gridLines, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={gridColor}
            transparent
            opacity={texture ? map.gridOpacity * 0.22 : map.gridOpacity * 0.65}
          />
        </lineSegments>
      )}
    </SceneItemTransformGroup>
  );
}
