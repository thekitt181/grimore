import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { MapItem } from '@/systems/scene/types';
import type { MapSceneScanResult, ScannedProp, ScannedStairs, ScannedWater, ScannedPit } from './mapImageSceneScan';
import { useImageSceneScan } from './useImageWallScan';
import { CLAY, clayMaterialProps } from './clayMaterials';

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

function PitFeature({ pit, gridSize }: { pit: ScannedPit; gridSize: number }) {
  const r = pit.radiusCells * gridSize;
  const depth = gridSize * 0.55;
  return (
    <group position={[pit.cx, 0, pit.cz]}>
      <mesh position={[0, -depth / 2, 0]} receiveShadow>
        <cylinderGeometry args={[r * 0.88, r * 0.92, depth, 32, 1, true]} />
        <meshStandardMaterial {...clayMaterialProps('pit')} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[r * 0.82, r * 1.02, 32]} />
        <meshStandardMaterial {...clayMaterialProps('pitRim')} />
      </mesh>
    </group>
  );
}

function WaterFeature({ water, gridSize }: { water: ScannedWater; gridSize: number }) {
  const r = water.radiusCells * gridSize;
  const isFountain = water.kind === 'fountain';

  return (
    <group position={[water.cx, 0, water.cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, isFountain ? 0.02 : -gridSize * 0.06, 0]} receiveShadow>
        <circleGeometry args={[r * 0.95, 32]} />
        <meshStandardMaterial {...clayMaterialProps('water')} transparent opacity={0.85} />
      </mesh>
      {isFountain && (
        <>
          <mesh position={[0, gridSize * 0.1, 0]} castShadow>
            <cylinderGeometry args={[r * 0.82, r * 0.92, gridSize * 0.14, 20]} />
            <meshStandardMaterial {...clayMaterialProps('wallDark')} />
          </mesh>
          <mesh position={[0, gridSize * 0.32, 0]} castShadow>
            <cylinderGeometry args={[r * 0.15, r * 0.2, gridSize * 0.38, 10]} />
            <meshStandardMaterial {...clayMaterialProps('prop')} />
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
          <meshStandardMaterial {...clayMaterialProps('propDark')} />
        </mesh>
      ))}
    </group>
  );
}

function PropFeature({ prop, gridSize, wallHeight }: { prop: ScannedProp; gridSize: number; wallHeight: number }) {
  const w = Math.max(gridSize * 0.2, prop.widthCells * gridSize * 0.9);
  const d = Math.max(gridSize * 0.2, prop.depthCells * gridSize * 0.9);
  const mat = clayMaterialProps('prop');
  const matDark = clayMaterialProps('propDark');
  const matLight = clayMaterialProps('propLight');

  if (prop.kind === 'chair') {
    const seatH = gridSize * 0.38;
    const backH = gridSize * 0.48;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, seatH / 2, 0]} castShadow>
          <boxGeometry args={[w * 0.9, seatH * 0.32, d * 0.9]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[0, seatH + backH / 2, -d * 0.35]} castShadow>
          <boxGeometry args={[w * 0.85, backH, d * 0.1]} />
          <meshStandardMaterial {...matDark} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'table') {
    const topH = gridSize * 0.1;
    const legH = gridSize * 0.48;
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
    const h = gridSize * 0.32;
    return (
      <group position={[prop.cx, 0, prop.cz]} rotation={[0, prop.rotation, 0]}>
        <mesh position={[0, h / 2, 0]} castShadow>
          <boxGeometry args={[w, h * 0.38, d * 0.5]} />
          <meshStandardMaterial {...mat} />
        </mesh>
      </group>
    );
  }

  if (prop.kind === 'pillar') {
    return (
      <mesh position={[prop.cx, wallHeight * 0.5, prop.cz]} castShadow receiveShadow>
        <cylinderGeometry args={[gridSize * 0.26, gridSize * 0.3, wallHeight * 1.05, 10]} />
        <meshStandardMaterial {...matDark} />
      </mesh>
    );
  }

  const h = Math.max(gridSize * 0.22, gridSize * 0.45 * Math.min(1, prop.widthCells + prop.depthCells));
  return (
    <mesh position={[prop.cx, h / 2, prop.cz]} rotation={[0, prop.rotation, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial {...mat} />
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

/** Full clay-style scene reconstruction from scanned map image features. */
export function Map3DScannedScene({ map, wallHeight }: { map: MapItem; wallHeight: number }) {
  const { result } = useImageSceneScan(map);
  if (!result || result.featureCount === 0) return null;
  return <ScannedSceneMeshes map={map} scene={result} wallHeight={wallHeight} />;
}
