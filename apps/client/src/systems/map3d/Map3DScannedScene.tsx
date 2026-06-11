import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import type { MapSceneScanResult, ScannedProp, ScannedStairs, ScannedWater } from './mapImageSceneScan';
import { useImageSceneScan } from './useImageWallScan';

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
  const cellSize = gridSize * 0.92;
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
      <meshStandardMaterial color="#1a1410" roughness={0.88} metalness={0.06} />
    </instancedMesh>
  );
}

function WaterFeature({ water, gridSize }: { water: ScannedWater; gridSize: number }) {
  const r = water.radiusCells * gridSize;
  const isFountain = water.kind === 'fountain';

  return (
    <group position={[water.cx, 0, water.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, isFountain ? 0.02 : -gridSize * 0.08, 0]} receiveShadow>
        <circleGeometry args={[r * 0.95, 32]} />
        <meshStandardMaterial color="#1a4a7a" roughness={0.15} metalness={0.35} transparent opacity={0.88} />
      </mesh>
      {isFountain && (
        <>
          <mesh position={[0, gridSize * 0.12, 0]} castShadow>
            <cylinderGeometry args={[r * 0.85, r * 0.95, gridSize * 0.18, 24]} />
            <meshStandardMaterial color="#4a5568" roughness={0.75} />
          </mesh>
          <mesh position={[0, gridSize * 0.35, 0]} castShadow>
            <cylinderGeometry args={[r * 0.18, r * 0.22, gridSize * 0.45, 12]} />
            <meshStandardMaterial color="#6b7280" roughness={0.6} metalness={0.2} />
          </mesh>
          <mesh position={[0, gridSize * 0.62, 0]}>
            <sphereGeometry args={[r * 0.12, 12, 12]} />
            <meshStandardMaterial color="#93c5fd" emissive="#3b82f6" emissiveIntensity={0.15} roughness={0.3} />
          </mesh>
        </>
      )}
    </group>
  );
}

function StairsFeature({ stair, gridSize, wallHeight }: { stair: ScannedStairs; gridSize: number; wallHeight: number }) {
  const stepH = wallHeight / stair.steps;
  const depth = stair.depthCells * gridSize;
  const width = stair.widthCells * gridSize;
  const stepDepth = depth / stair.steps;

  return (
    <group position={[stair.cx, 0, stair.cz]} rotation={[0, stair.rotation, 0]}>
      {Array.from({ length: stair.steps }, (_, i) => (
        <mesh
          key={i}
          position={[0, stepH * (i + 0.5), -depth / 2 + stepDepth * (i + 0.5)]}
          castShadow
          receiveShadow
        >
          <boxGeometry args={[width * 0.92, stepH, stepDepth * 0.95]} />
          <meshStandardMaterial color="#5c5048" roughness={0.82} />
        </mesh>
      ))}
    </group>
  );
}

function PropFeature({ prop, gridSize, wallHeight }: { prop: ScannedProp; gridSize: number; wallHeight: number }) {
  const w = prop.widthCells * gridSize * 0.85;
  const d = prop.depthCells * gridSize * 0.85;

  if (prop.kind === 'chair') {
    const seatH = gridSize * 0.45;
    const backH = gridSize * 0.55;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, seatH / 2, 0]} castShadow>
          <boxGeometry args={[w * 0.9, seatH * 0.35, d * 0.9]} />
          <meshStandardMaterial color="#4a3728" roughness={0.8} />
        </mesh>
        <mesh position={[0, seatH + backH / 2, -d * 0.38]} castShadow>
          <boxGeometry args={[w * 0.88, backH, d * 0.12]} />
          <meshStandardMaterial color="#3d2e22" roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'table') {
    const topH = gridSize * 0.12;
    const legH = gridSize * 0.55;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, legH + topH / 2, 0]} castShadow receiveShadow>
          <boxGeometry args={[w, topH, d]} />
          <meshStandardMaterial color="#5c4033" roughness={0.75} />
        </mesh>
        <mesh position={[0, legH / 2, 0]} castShadow>
          <cylinderGeometry args={[Math.min(w, d) * 0.08, Math.min(w, d) * 0.1, legH, 8]} />
          <meshStandardMaterial color="#3d2e22" roughness={0.85} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'bench') {
    const h = gridSize * 0.35;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w, h * 0.4, d * 0.55]} />
          <meshStandardMaterial color="#4a3728" roughness={0.8} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'pillar') {
    return (
      <mesh position={[prop.cx, wallHeight * 0.55, prop.cz]} castShadow receiveShadow>
        <cylinderGeometry args={[gridSize * 0.28, gridSize * 0.32, wallHeight * 1.1, 10]} />
        <meshStandardMaterial color="#3d3835" roughness={0.78} metalness={0.12} />
      </mesh>
    );
  }

  const h = gridSize * 0.5;
  return (
    <mesh position={[prop.cx, h / 2, prop.cz]} rotation={[0, prop.rotation, 0]} castShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color="#554840" roughness={0.82} />
    </mesh>
  );
}

function ScannedSceneMeshes({
  map,
  scene,
  wallHeight,
}: {
  map: MapItem;
  scene: MapSceneScanResult;
  wallHeight: number;
}) {
  const gs = map.gridSize;

  return (
    <group>
      <VoxelWalls
        map={map}
        wallCells={scene.wallCells}
        cols={scene.cols}
        rows={scene.rows}
        wallHeight={wallHeight}
      />
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

/** Full scene reconstruction from scanned map image features. */
export function Map3DScannedScene({ map, wallHeight }: { map: MapItem; wallHeight: number }) {
  const { result } = useImageSceneScan(map);
  if (!result || result.featureCount === 0) return null;
  return <ScannedSceneMeshes map={map} scene={result} wallHeight={wallHeight} />;
}
