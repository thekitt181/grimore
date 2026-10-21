import { useMemo, useEffect } from 'react';
import type { MapItem } from '@/systems/scene/types';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { MapSceneScanResult, ScannedDoor, ScannedWallSegment } from './mapImageSceneScan';
import { useImageSceneScan } from './useImageWallScan';
import { resolveMapSurfaceStyle } from './mapSurfaceStyles';
import { getMapSurfaceTexture, tileSurfaceTexture } from './mapSurfaceTextures';

function WallSegments({
  mapId,
  segments,
  wallHeight,
  color,
  roughness,
  art,
  tileWorld,
}: {
  mapId: string;
  segments: ScannedWallSegment[];
  wallHeight: number;
  color: string;
  roughness: number;
  art: ReturnType<typeof getMapSurfaceTexture>;
  tileWorld: number;
}) {
  const maps = useMemo(() => {
    if (!art) return null;
    return segments.map((seg) => tileSurfaceTexture(art, seg.length, wallHeight, tileWorld));
  }, [art, segments, wallHeight, tileWorld]);

  useEffect(() => () => {
    maps?.forEach((t) => t.dispose());
  }, [maps]);

  if (segments.length === 0) return null;
  return (
    <group>
      {segments.map((seg, i) => (
        <mesh
          key={seg.id}
          position={[seg.cx, wallHeight / 2, seg.cz]}
          rotation={[0, seg.rotation, 0]}
          castShadow
          receiveShadow
          userData={{
            fpSurface: 'wall',
            mapId,
            wallIndex: i,
            // Box length is local +X; after rotY: world Δ = (cos θ, −sin θ).
            ax: seg.cx - Math.cos(seg.rotation) * (seg.length / 2),
            ay: seg.cz + Math.sin(seg.rotation) * (seg.length / 2),
            bx: seg.cx + Math.cos(seg.rotation) * (seg.length / 2),
            by: seg.cz - Math.sin(seg.rotation) * (seg.length / 2),
          }}
        >
          <boxGeometry args={[seg.length, wallHeight, seg.thickness]} />
          {maps?.[i] ? (
            <meshStandardMaterial map={maps[i]} color="#ffffff" roughness={roughness} metalness={0.06} />
          ) : (
            <meshStandardMaterial color={color} roughness={roughness} metalness={0.02} />
          )}
        </mesh>
      ))}
    </group>
  );
}

function DoorOpening({
  door,
  gridSize,
  wallHeight,
  color,
  roughness,
}: {
  door: ScannedDoor;
  gridSize: number;
  wallHeight: number;
  color: string;
  roughness: number;
}) {
  const w = Math.max(gridSize * 0.5, door.widthCells * gridSize);
  const frameW = gridSize * 0.08;
  const frameD = gridSize * 0.1;
  const mat = { color, roughness, metalness: 0.02 };

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
  const wallStyleId = useMapStore((s) => s.wallStyleId);
  const style = resolveMapSurfaceStyle(wallStyleId);
  const art = useMemo(() => getMapSurfaceTexture(wallStyleId, 'wall'), [wallStyleId]);

  return (
    <group>
      <WallSegments
        mapId={map.id}
        segments={scene.wallSegments}
        wallHeight={wallHeight}
        color={style.wall}
        roughness={style.wallRoughness}
        art={art}
        tileWorld={gs * 0.85}
      />
      {scene.doors.map((d) => (
        <DoorOpening
          key={d.id}
          door={d}
          gridSize={gs}
          wallHeight={wallHeight}
          color={style.wallDark}
          roughness={style.wallRoughness}
        />
      ))}
    </group>
  );
}

export function Map3DScannedScene({ map, wallHeight }: { map: MapItem; wallHeight: number }) {
  const { result } = useImageSceneScan(map);
  if (!result || result.featureCount === 0) return null;
  return <ScannedSceneMeshes map={map} scene={result} wallHeight={wallHeight} />;
}
