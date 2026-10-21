import { useMemo, useSyncExternalStore, useRef } from 'react';
import { Line } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MapItem, SurfaceDecalItem } from '@/systems/scene/types';
import { useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import { isSceneItemOnTable } from '@/systems/scene/sceneMapsForClient';
import { useMapStore } from '@/systems/map/store/mapStore';
import { getFpPaintPreview, subscribeFpPaintPreview } from './fpSurfacePaint';
import { getFpBreachPreview, subscribeFpBreachPreview } from './fpWallBreach';
import { useFirstPersonStore } from './firstPersonStore';
import { raycastFpSurface } from './fpSurfaceRaycast';
import { fpSceneRef } from './fpSceneRef';

function floorWorldPoints(item: SurfaceDecalItem): [number, number, number][] {
  const y = 0.12;
  const pts: [number, number, number][] = [];
  for (let i = 0; i + 1 < item.points.length; i += 2) {
    pts.push([item.x + (item.points[i] ?? 0), y, item.y + (item.points[i + 1] ?? 0)]);
  }
  return pts;
}

function wallWorldPoints(item: SurfaceDecalItem, map: MapItem | undefined): [number, number, number][] {
  const a = item.wallA;
  const b = item.wallB;
  if (!a || !b || !map) return [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const nz = ux;
  const thick = Math.max(4, (map.gridSize || 96) * 0.12);
  const off = thick * 0.55 + 0.8;

  const pts: [number, number, number][] = [];
  for (let i = 0; i + 1 < item.points.length; i += 2) {
    const along = item.points[i] ?? 0;
    const h = item.points[i + 1] ?? 0;
    const lx = a.x + ux * along;
    const ly = a.y + uy * along;
    pts.push([map.x + lx + nx * off, h, map.y + ly + nz * off]);
  }
  return pts;
}

function DecalRibbon({ item, map }: { item: SurfaceDecalItem; map: MapItem | undefined }) {
  const points = useMemo(() => {
    if (item.surface === 'floor') return floorWorldPoints(item);
    return wallWorldPoints(item, map);
  }, [item, map]);

  if (points.length < 2) return null;
  return (
    <Line
      points={points}
      color={item.color}
      lineWidth={Math.max(2, item.stroke * 0.9)}
      transparent
      opacity={0.95}
      depthTest={false}
      renderOrder={20}
    />
  );
}

function previewWorldLine(worldPts: number[], wall: boolean): [number, number, number][] {
  const out: [number, number, number][] = [];
  if (wall) {
    for (let i = 0; i + 2 < worldPts.length; i += 3) {
      out.push([worldPts[i]!, worldPts[i + 1]!, worldPts[i + 2]!]);
    }
  } else {
    for (let i = 0; i + 1 < worldPts.length; i += 2) {
      out.push([worldPts[i]!, 0.16, worldPts[i + 1]!]);
    }
  }
  return out;
}

function CircleGhost({
  center,
  radius,
  nx,
  nz,
  color,
  wall,
}: {
  center: { x: number; y: number; z: number };
  radius: number;
  nx?: number;
  nz?: number;
  color: string;
  wall: boolean;
}) {
  const quat = useMemo(() => {
    const q = new THREE.Quaternion();
    if (wall && nx != null && nz != null) {
      // Circle lies on wall face (normal = wall outward).
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(nx, 0, nz).normalize());
    } else {
      q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    }
    return q;
  }, [nx, nz, wall]);

  return (
    <mesh position={[center.x, center.y, center.z]} quaternion={quat} renderOrder={25}>
      <circleGeometry args={[Math.max(2, radius), 48]} />
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.35}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

function LiveSprayPreview() {
  const preview = useSyncExternalStore(subscribeFpPaintPreview, getFpPaintPreview, getFpPaintPreview);
  const points = useMemo(() => {
    if (!preview?.mapId) return [] as [number, number, number][];
    return previewWorldLine(preview.worldPts, preview.surface === 'wall');
  }, [preview]);

  if (!preview?.mapId) return null;
  return (
    <group>
      {preview.shape === 'circle' && preview.centerWorld && preview.radius != null && (
        <CircleGhost
          center={preview.centerWorld}
          radius={preview.radius}
          {...(preview.nx != null ? { nx: preview.nx } : {})}
          {...(preview.nz != null ? { nz: preview.nz } : {})}
          color={preview.color}
          wall={preview.surface === 'wall'}
        />
      )}
      {points.length >= 2 && (
        <Line
          points={points}
          color={preview.color}
          lineWidth={Math.max(3, preview.stroke)}
          transparent
          opacity={0.95}
          depthTest={false}
          renderOrder={26}
        />
      )}
    </group>
  );
}

function LiveBreachPreview() {
  const preview = useSyncExternalStore(subscribeFpBreachPreview, getFpBreachPreview, getFpBreachPreview);
  const points = useMemo(() => {
    if (!preview) return [] as [number, number, number][];
    return previewWorldLine(preview.worldPts, true);
  }, [preview]);

  if (!preview || points.length < 2) return null;
  return (
    <group>
      {preview.shape === 'circle' && preview.centerWorld && preview.radius != null && (
        <CircleGhost
          center={preview.centerWorld}
          radius={preview.radius}
          {...(preview.nx != null ? { nx: preview.nx } : {})}
          {...(preview.nz != null ? { nz: preview.nz } : {})}
          color="#fb923c"
          wall
        />
      )}
      <Line
        points={points}
        color="#f97316"
        lineWidth={Math.max(3, preview.stroke * 0.8)}
        transparent
        opacity={1}
        depthTest={false}
        renderOrder={26}
      />
    </group>
  );
}

/** Hover aim stamp — updated every frame (no React lag) so it tracks the crosshair. */
function AimCursor() {
  const tool = useFirstPersonStore((s) => s.tool);
  const brush = useFirstPersonStore((s) => s.brushSize);
  const drawColor = useMapStore((s) => s.drawColor);
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const geoRef = useRef<THREE.CircleGeometry | null>(null);
  const lastR = useRef(0);
  const qWall = useRef(new THREE.Quaternion());
  const qFloor = useRef(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)));
  const nTmp = useRef(new THREE.Vector3());
  const zAxis = useRef(new THREE.Vector3(0, 0, 1));

  useFrame(() => {
    const mesh = meshRef.current;
    const mat = matRef.current;
    if (!mesh || !mat) return;

    if (tool !== 'spray' && tool !== 'breach' && tool !== 'erase') {
      mesh.visible = false;
      return;
    }
    // Live stroke preview owns the look while drawing.
    if (getFpPaintPreview()?.mapId || getFpBreachPreview()) {
      mesh.visible = false;
      return;
    }

    const hit = raycastFpSurface(fpSceneRef.current);
    if (!hit) {
      mesh.visible = false;
      return;
    }

    const r = Math.max(6, brush * 1.1);
    if (!geoRef.current || Math.abs(r - lastR.current) > 0.25) {
      geoRef.current?.dispose();
      geoRef.current = new THREE.CircleGeometry(r, 48);
      mesh.geometry = geoRef.current;
      lastR.current = r;
    }

    mesh.position.set(
      hit.worldX,
      hit.surface === 'floor' ? Math.max(0.12, hit.worldY + 0.04) : hit.worldY,
      hit.worldZ,
    );

    if (hit.surface === 'wall') {
      nTmp.current.set(hit.nx, 0, hit.nz).normalize();
      qWall.current.setFromUnitVectors(zAxis.current, nTmp.current);
      mesh.quaternion.copy(qWall.current);
    } else {
      mesh.quaternion.copy(qFloor.current);
    }

    mat.color.set(tool === 'breach' ? '#fb923c' : tool === 'erase' ? '#ef4444' : drawColor);
    mesh.visible = true;
  });

  return (
    <mesh ref={meshRef} visible={false} renderOrder={25}>
      <circleGeometry args={[8, 48]} />
      <meshBasicMaterial
        ref={matRef}
        transparent
        opacity={0.38}
        depthTest={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

export function Map3DSurfaceDecals() {
  const items = useItemStore(selectSortedItems);
  const gm = useSessionStore((s) => s.myRole === 'GM');
  const decals = useMemo(
    () => items.filter((i): i is SurfaceDecalItem => i.type === 'surfaceDecal' && isSceneItemOnTable(i, gm)),
    [items, gm],
  );
  const mapsById = useMemo(() => {
    const m = new Map<string, MapItem>();
    for (const it of items) {
      if (it.type === 'map') m.set(it.id, it);
    }
    return m;
  }, [items]);

  return (
    <group>
      {decals.map((d) => (
        <DecalRibbon key={d.id} item={d} map={mapsById.get(d.mapId)} />
      ))}
      <LiveSprayPreview />
      <LiveBreachPreview />
      <AimCursor />
    </group>
  );
}
