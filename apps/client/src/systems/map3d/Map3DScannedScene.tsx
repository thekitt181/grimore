import type { MapItem } from '@/systems/scene/types';
import type { MapSceneScanResult, ScannedDoor, ScannedWallSegment } from './mapImageSceneScan';
import { useImageSceneScan } from './useImageWallScan';
import { clayMaterialProps } from './clayMaterials';

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

function DoorOpening({ door, gridSize, wallHeight }: { door: ScannedDoor; gridSize: number; wallHeight: number }) {
  const w = Math.max(gridSize * 0.5, door.widthCells * gridSize);
  const frameW = gridSize * 0.08;
  const frameD = gridSize * 0.1;
  const mat = clayMaterialProps('wallDark');

  if (door.rotation === 0) {
    return (
      <group position={[door.cx, 0, door.cz]}>
        <mesh position={[-w / 2 - frameW / 2, wallHeight / 2, 0]} castShadow>
          <boxGeometry args={[frameW, wallHeight, frameD]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[w / 2 + frameW / 2, wallHeight / 2, 0]} castShadow>
          <boxGeometry args={[frameW, wallHeight, frameD]} />
          <meshStandardMaterial {...mat} />
        </mesh>
        <mesh position={[0, wallHeight - frameW / 2, 0]} castShadow>
          <boxGeometry args={[w + frameW * 2, frameW, frameD]} />
          <meshStandardMaterial {...mat} />
        </mesh>
      </group>
    );
  }

  return (
    <group position={[door.cx, 0, door.cz]}>
      <mesh position={[0, wallHeight / 2, -w / 2 - frameW / 2]} castShadow>
        <boxGeometry args={[frameD, wallHeight, frameW]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, wallHeight / 2, w / 2 + frameW / 2]} castShadow>
        <boxGeometry args={[frameD, wallHeight, frameW]} />
        <meshStandardMaterial {...mat} />
      </mesh>
      <mesh position={[0, wallHeight - frameW / 2, 0]} castShadow>
        <boxGeometry args={[frameD, frameW, w + frameW * 2]} />
        <meshStandardMaterial {...mat} />
      </mesh>
    </group>
  );
}

function ScannedSceneMeshes({ map, scene, wallHeight }: { map: MapItem; scene: MapSceneScanResult; wallHeight: number }) {
  const gs = map.gridSize;

  return (
    <group>
      <WallSegments segments={scene.wallSegments} wallHeight={wallHeight} />
      {scene.doors.map((d) => (
        <DoorOpening key={d.id} door={d} gridSize={gs} wallHeight={wallHeight} />
      ))}
    </group>
  );
}

export function Map3DScannedScene({ map, wallHeight }: { map: MapItem; wallHeight: number }) {
  const { result } = useImageSceneScan(map);
  if (!result || result.featureCount === 0) return null;
  return <ScannedSceneMeshes map={map} scene={result} wallHeight={wallHeight} />;
}
