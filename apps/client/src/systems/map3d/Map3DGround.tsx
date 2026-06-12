import { useMemo } from 'react';
import type { MapItem } from '@/systems/scene/types';
import { itemCenterXZ } from './coords';
import { useThreeTexture } from './useThreeTexture';
import { CLAY, clayMaterialProps } from './clayMaterials';

export function Map3DGround({ map, clayMode = false }: { map: MapItem; clayMode?: boolean }) {
  const { texture, status } = useThreeTexture(map.backgroundUrl);
  const [cx, cz] = itemCenterXZ(map);

  const gridLines = useMemo(() => {
    if (!map.showGrid || clayMode) return null;
    const cols = Math.ceil(map.width / map.gridSize);
    const rows = Math.ceil(map.height / map.gridSize);
    const points: number[] = [];
    const ox = map.x + map.gridOffsetX;
    const oz = map.y + map.gridOffsetY;

    for (let c = 0; c <= cols; c++) {
      const x = ox + c * map.gridSize;
      points.push(x, 0.02, oz, x, 0.02, oz + rows * map.gridSize);
    }
    for (let r = 0; r <= rows; r++) {
      const z = oz + r * map.gridSize;
      points.push(ox, 0.02, z, ox + cols * map.gridSize, 0.02, z);
    }
    return new Float32Array(points);
  }, [map, clayMode]);

  const gridColor = `#${map.gridColor.toString(16).padStart(6, '0')}`;

  const floorMaterial = clayMode
    ? texture
      ? { map: texture, color: '#ffffff', roughness: 0.94, metalness: 0.01 }
      : clayMaterialProps('floor')
    : texture
      ? { map: texture, color: '#ffffff', roughness: 0.88, metalness: 0.02, emissive: '#ffffff', emissiveIntensity: 0.12 }
      : { color: status === 'error' ? '#3d2020' : '#252532', roughness: 0.92, metalness: 0.02 };

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0, cz]} receiveShadow={false}>
        <planeGeometry args={[map.width, map.height, 1, 1]} />
        <meshStandardMaterial {...floorMaterial} />
      </mesh>

      {!texture && status !== 'loading' && !clayMode && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx, 0.01, cz]}>
          <planeGeometry args={[map.width, map.height]} />
          <meshStandardMaterial color="#252532" wireframe transparent opacity={0.15} />
        </mesh>
      )}

      {gridLines && (
        <lineSegments position={[0, 0, 0]}>
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
    </group>
  );
}
