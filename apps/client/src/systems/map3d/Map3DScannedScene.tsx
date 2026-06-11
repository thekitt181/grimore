import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import type { MapSceneScanResult, ScannedProp, ScannedStairs, ScannedWater, ScannedPit, ScannedWallSegment } from './mapImageSceneScan';
import { useImageSceneScan } from './useImageWallScan';
import { clayMaterialProps } from './clayMaterials';

function VoxelWalls({
  map,
  wallCells,
  cols,
  rows,
  wallHeight,
}: {
  map: MapItem;
  wallCells: Uint8Array;
  cols: number;
  rows: number;
  wallHeight: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const gridSize = map.gridSize;
  const cellSize = gridSize * 0.94;
  const ox = map.x + map.gridOffsetX;
  const oz = map.y + map.gridOffsetY;

  const count = useMemo(() => {
    let n = 0;
    for (let i = 0; i < wallCells.length; i++) if (wallCells[i]) n++;
    return n;
  }, [wallCells]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;
    const tmp = new THREE.Object3D();
    let i = 0;
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (!wallCells[cy * cols + cx]) continue;
        tmp.position.set(ox + cx * gridSize + gridSize / 2, wallHeight / 2, oz + cy * gridSize + gridSize / 2);
        tmp.rotation.set(0, 0, 0);
        tmp.updateMatrix();
        mesh.setMatrixAt(i++, tmp.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  }, [wallCells, cols, rows, count, gridSize, ox, oz, wallHeight]);

  if (count === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} castShadow receiveShadow>
      <boxGeometry args={[cellSize, wallHeight, cellSize]} />
      <meshStandardMaterial {...clayMaterialProps('wall')} />
    </instancedMesh>
  );
}

function WallSegments({ segments, wallHeight }: { segments: ScannedWallSegment[]; wallHeight: number }) {
  if (segments.length === 0) return null;
  return (
    <group>
      {segments.map((seg) => (
        <mesh
          key={seg.id}
          position={[seg.cx, wallHeight / 2, seg.cz]}
          rotation={[0, seg.rotation, 0]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[seg.length, wallHeight, seg.thickness]} />
          <meshStandardMaterial {...clayMaterialProps('wall')} />
        </mesh>
      ))}
    </group>
  );
}

function PitFeature({ pit, gridSize }: { pit: ScannedPit; gridSize: number }) {
  const r = pit.radiusCells * gridSize;
  const depth = gridSize * 0.65;
  return (
    <group position={[pit.cx, 0, pit.cz]}>
      <mesh position={[0, -depth / 2, 0]} receiveShadow>
        <cylinderGeometry args={[r * 0.9, r * 0.94, depth, 32, 1, true]} />
        <meshStandardMaterial {...clayMaterialProps('pit')} side={2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[r * 0.84, r * 1.02, 32]} />
        <meshStandardMaterial {...clayMaterialProps('pitRim')} />
      </mesh>
    </group>
  );
}

function WaterFeature({ water, gridSize }: { water: ScannedWater; gridSize: number }) {
  const r = water.radiusCells * gridSize;
  return (
    <group position={[water.cx, 0, water.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -gridSize * 0.05, 0]} receiveShadow>
        <circleGeometry args={[r * 0.94, 32]} />
        <meshStandardMaterial {...clayMaterialProps('water')} transparent opacity={0.9} />
      </mesh>
    </group>
  );
}

function StairsFeature({ stair, gridSize, wallHeight }: { stair: ScannedStairs; gridSize: number; wallHeight: number }) {
  const stepH = wallHeight / stair.steps;
  const depth = stair.depthCells * gridSize;
  const width = stair.widthCells * gridSize;
  const stepDepth = depth / stair.steps;
  const mat = clayMaterialProps('propDark');

  return (
    <group position={[stair.cx, 0, stair.cz]} rotation={[0, stair.rotation, 0]}>
      {Array.from({ length: stair.steps }, (_, i) => (
        <mesh key={i} position={[0, stepH * (i + 0.5), -depth / 2 + stepDepth * (i + 0.5)]} castShadow receiveShadow>
          <boxGeometry args={[width * 0.92, stepH, stepDepth * 0.95]} />
          <meshStandardMaterial {...mat} />
        </mesh>
      ))}
    </group>
  );
}

function PropFeature({ prop, gridSize, wallHeight }: { prop: ScannedProp; gridSize: number; wallHeight: number }) {
  const w = Math.max(gridSize * 0.28, prop.widthCells * gridSize * 0.9);
  const d = Math.max(gridSize * 0.28, prop.depthCells * gridSize * 0.9);
  const mat = clayMaterialProps('prop');
  const matDark = clayMaterialProps('propDark');
  const matLight = clayMaterialProps('propLight');

  if (prop.kind === 'torch') {
    return (
      <group position={[prop.cx, gridSize * 0.35, prop.cz]}>
        <mesh castShadow>
          <cylinderGeometry args={[gridSize * 0.04, gridSize * 0.05, gridSize * 0.35, 6]} />
          <meshStandardMaterial {...matDark} />
        </mesh>
        <mesh position={[0, gridSize * 0.22, 0]}>
          <sphereGeometry args={[gridSize * 0.07, 8, 8]} />
          <meshStandardMaterial color="#c9a84c" emissive="#ff9933" emissiveIntensity={0.55} roughness={0.4} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'bed') {
    const bedH = gridSize * 0.28;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, bedH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, bedH, d]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[0, bedH + gridSize * 0.06, -d * 0.38]} castShadow>
          <boxGeometry args={[w * 0.92, gridSize * 0.12, d * 0.18]} />
          <meshStandardMaterial {...matLight} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'shelf') {
    const h = gridSize * 0.55;
    return (
      <mesh position={[prop.cx, h / 2, prop.cz]} rotation={[0, prop.rotation, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d * 0.35]} />
        <meshStandardMaterial {...matDark} />
      </mesh>
    );
  }

  if (prop.kind === 'chair') {
    const seatH = gridSize * 0.32;
    const backH = gridSize * 0.42;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, seatH / 2, 0]} castShadow>
          <boxGeometry args={[w * 0.85, seatH * 0.35, d * 0.85]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[0, seatH + backH / 2, -d * 0.35]} castShadow>
          <boxGeometry args={[w * 0.82, backH, d * 0.1]} />
          <meshStandardMaterial {...matDark} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'table') {
    const topH = gridSize * 0.09;
    const legH = gridSize * 0.42;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, legH + topH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, topH, d]} />
          <meshStandardMaterial {...matLight} />
        </mesh>
        <mesh position={[0, legH / 2, 0]} castShadow>
          <cylinderGeometry args={[Math.min(w, d) * 0.07, Math.min(w, d) * 0.09, legH, 8]} />
          <meshStandardMaterial {...matDark} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'bench') {
    const h = gridSize * 0.28;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w, h * 0.38, d * 0.48]} />
          <meshStandardMaterial {...mat} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'pillar') {
    return (
      <mesh position={[prop.cx, wallHeight * 0.48, prop.cz]} castShadow receiveShadow>
        <cylinderGeometry args={[gridSize * 0.24, gridSize * 0.28, wallHeight, 10]} />
        <meshStandardMaterial {...matDark} />
      </mesh>
    );
  }

  const h = Math.max(gridSize * 0.22, gridSize * 0.4 * Math.min(1.2, prop.widthCells + prop.depthCells));
  return (
    <mesh position={[prop.cx, h / 2, prop.cz]} rotation={[0, prop.rotation, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial {...mat} />
    </mesh>
  );
}

function ScannedSceneMeshes({ map, scene, wallHeight }: { map: MapItem; scene: MapSceneScanResult; wallHeight: number }) {
  const gs = map.gridSize;
  const useSegments = scene.wallSegments.length > 0;

  return (
    <group>
      {useSegments ? (
        <WallSegments segments={scene.wallSegments} wallHeight={wallHeight} />
      ) : (
        <VoxelWalls map={map} wallCells={scene.wallCells} cols={scene.cols} rows={scene.rows} wallHeight={wallHeight} />
      )}
      {scene.pits.map((p) => (
        <PitFeature key={p.id} pit={p} gridSize={gs} />
      ))}
      {scene.waters.map((w) => (
        <WaterFeature key={w.id} water={w} gridSize={gs} />
      ))}
      {scene.stairs.map((s) => (
        <StairsFeature key={s.id} stair={s} gridSize={gs} wallHeight={wallHeight} />
      ))}
      {scene.props.map((p) => (
        <PropFeature key={p.id} prop={p} gridSize={gs} wallHeight={wallHeight} />
      ))}
    </group>
  );
}

export function Map3DScannedScene({ map, wallHeight }: { map: MapItem; wallHeight: number }) {
  const { result } = useImageSceneScan(map);
  if (!result || result.featureCount === 0) return null;
  return <ScannedSceneMeshes map={map} scene={result} wallHeight={wallHeight} />;
}
