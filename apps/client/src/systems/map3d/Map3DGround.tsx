import { useMemo, useEffect, useLayoutEffect, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import { useThreeTexture } from './useThreeTexture';
import { resolveMapSurfaceStyle } from './mapSurfaceStyles';
import {
  getMapSurfaceTexture,
  tileSurfaceTexture,
  usesArtFloor,
} from './mapSurfaceTextures';
import { SceneItemTransformGroup } from './TokenTransformGroup';

function FloorPlane({
  map,
  clayMode,
}: {
  map: MapItem;
  clayMode: boolean;
}) {
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const floorStyleId = useMapStore((s) => s.floorStyleId);
  const floorStyle = resolveMapSurfaceStyle(floorStyleId);
  const artFloor = usesArtFloor(floorStyleId);
  // Only load map image when we actually need it (avoids covering art).
  const { texture: mapTex, status } = useThreeTexture(artFloor ? null : map.backgroundUrl);

  const artMap = useMemo(() => {
    if (!artFloor) return null;
    const base = getMapSurfaceTexture(floorStyleId, 'floor');
    if (!base) return null;
    const tiled = tileSurfaceTexture(base, map.width, map.height, Math.max(48, (map.gridSize || 96) * 0.75));
    tiled.needsUpdate = true;
    return tiled;
  }, [artFloor, floorStyleId, map.width, map.height, map.gridSize]);

  useEffect(() => () => {
    artMap?.dispose();
  }, [artMap]);

  // R3F often keeps the previous `map` when swapping textures — force it.
  useLayoutEffect(() => {
    const mat = matRef.current;
    if (!mat) return;
    if (artMap) {
      mat.map = artMap;
      mat.color.set('#ffffff');
      mat.emissive.set('#000000');
      mat.emissiveIntensity = 0;
      mat.roughness = floorStyle.floorRoughness;
      mat.metalness = 0.04;
    } else if (mapTex) {
      mat.map = mapTex;
      mat.color.set('#ffffff');
      mat.emissive.set(clayMode ? '#000000' : '#ffffff');
      mat.emissiveIntensity = clayMode ? 0 : 0.12;
      mat.roughness = clayMode ? 0.94 : 0.88;
      mat.metalness = clayMode ? 0.01 : 0.02;
    } else {
      mat.map = null;
      mat.color.set(status === 'error' ? '#3d2020' : floorStyle.floor);
      mat.emissive.set('#000000');
      mat.emissiveIntensity = 0;
      mat.roughness = floorStyle.floorRoughness;
      mat.metalness = 0.02;
    }
    mat.needsUpdate = true;
  }, [artMap, mapTex, clayMode, floorStyle, status]);

  return (
    <mesh
      key={`floor-${floorStyleId}-${artFloor ? 'art' : 'map'}`}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, artFloor ? 0.03 : 0, 0]}
      receiveShadow={false}
      renderOrder={0}
      userData={{ fpSurface: 'floor', mapId: map.id }}
    >
      <planeGeometry args={[map.width, map.height, 1, 1]} />
      <meshStandardMaterial
        ref={matRef}
        side={THREE.DoubleSide}
        depthWrite
        toneMapped
      />
    </mesh>
  );
}

export function Map3DGround({
  map,
  clayMode = false,
  skipFloor = false,
}: {
  map: MapItem;
  clayMode?: boolean;
  skipFloor?: boolean;
}) {
  const floorStyleId = useMapStore((s) => s.floorStyleId);
  const artFloor = usesArtFloor(floorStyleId);

  const gridLines = useMemo(() => {
    if (!map.showGrid || clayMode) return null;
    const w = map.width;
    const h = map.height;
    const cols = Math.ceil(w / map.gridSize);
    const rows = Math.ceil(h / map.gridSize);
    const points: number[] = [];
    const ox = -w / 2 + map.gridOffsetX;
    const oz = -h / 2 + map.gridOffsetY;

    for (let c = 0; c <= cols; c++) {
      const lx = ox + c * map.gridSize;
      points.push(lx, 0.02, oz, lx, 0.02, oz + rows * map.gridSize);
    }
    for (let r = 0; r <= rows; r++) {
      const lz = oz + r * map.gridSize;
      points.push(ox, 0.02, lz, ox + cols * map.gridSize, 0.02, lz);
    }
    return new Float32Array(points);
  }, [map.showGrid, map.width, map.height, map.gridSize, map.gridOffsetX, map.gridOffsetY, map.gridColor, clayMode]);

  const gridColor = `#${map.gridColor.toString(16).padStart(6, '0')}`;

  return (
    <SceneItemTransformGroup itemId={map.id} surfaceY={0} baseWidth={map.width} baseHeight={map.height}>
      {!skipFloor && <FloorPlane map={map} clayMode={clayMode} />}

      {gridLines && (
        <lineSegments position={[0, artFloor ? 0.04 : 0.02, 0]}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[gridLines, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            color={gridColor}
            transparent
            opacity={map.gridOpacity * (artFloor ? 0.28 : 0.45)}
          />
        </lineSegments>
      )}
    </SceneItemTransformGroup>
  );
}
