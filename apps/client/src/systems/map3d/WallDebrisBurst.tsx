import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { MapBreachFx, MapItem } from '@/systems/scene/types';
import { useItemStore, selectSortedItems } from '@/systems/scene/store/itemStore';

type Shard = {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
};

const playedIds = new Set<string>();
const GRAVITY = -980;
const LIFETIME = 1.15;

function spawnBurst(parent: THREE.Group, fx: MapBreachFx, gridSize: number): Shard[] {
  const shards: Shard[] = [];
  const count = 10 + Math.floor(Math.random() * 7);
  const size = Math.max(4, gridSize * 0.08);
  for (let i = 0; i < count; i++) {
    const geo = new THREE.BoxGeometry(
      size * (0.5 + Math.random()),
      size * (0.4 + Math.random() * 0.8),
      size * (0.5 + Math.random()),
    );
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color().setHSL(0.06, 0.25 + Math.random() * 0.2, 0.28 + Math.random() * 0.18),
      roughness: 0.92,
      metalness: 0.04,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(
      fx.x + (Math.random() - 0.5) * size * 2,
      fx.y + Math.random() * size,
      fx.z + (Math.random() - 0.5) * size * 2,
    );
    mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    parent.add(mesh);
    const outward = 120 + Math.random() * 180;
    const side = (Math.random() - 0.5) * 90;
    shards.push({
      mesh,
      vx: fx.nx * outward + -fx.nz * side,
      vy: 80 + Math.random() * 140,
      vz: fx.nz * outward + fx.nx * side,
      life: LIFETIME * (0.75 + Math.random() * 0.35),
    });
  }
  return shards;
}

function MapDebrisLayer({ map }: { map: MapItem }) {
  const groupRef = useRef<THREE.Group>(null);
  const shardsRef = useRef<Shard[]>([]);
  const fx = map.breachFx ?? null;
  const fxId = fx?.id ?? '';

  useEffect(() => {
    const group = groupRef.current;
    if (!group || !fx || !fxId) return;
    if (playedIds.has(fxId)) return;
    playedIds.add(fxId);
    // Cap memory of played ids
    if (playedIds.size > 80) {
      const first = playedIds.values().next().value;
      if (first) playedIds.delete(first);
    }
    const spawned = spawnBurst(group, fx, map.gridSize || 96);
    shardsRef.current.push(...spawned);
  }, [fx, fxId, map.gridSize]);

  useFrame((_, dt) => {
    const shards = shardsRef.current;
    if (shards.length === 0) return;
    const step = Math.min(dt, 0.05);
    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i]!;
      s.life -= step;
      s.vy += GRAVITY * step;
      s.mesh.position.x += s.vx * step;
      s.mesh.position.y += s.vy * step;
      s.mesh.position.z += s.vz * step;
      s.mesh.rotation.x += step * 4;
      s.mesh.rotation.z += step * 3;
      if (s.mesh.position.y < 0.5) {
        s.mesh.position.y = 0.5;
        s.vy *= -0.25;
        s.vx *= 0.7;
        s.vz *= 0.7;
      }
      if (s.life <= 0) {
        s.mesh.parent?.remove(s.mesh);
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        shards.splice(i, 1);
      }
    }
  });

  return <group ref={groupRef} />;
}

export function WallDebrisBurst() {
  const items = useItemStore(selectSortedItems);
  const maps = useMemo(
    () => items.filter((i): i is MapItem => i.type === 'map' && Boolean(i.breachFx)),
    [items],
  );
  return (
    <group>
      {maps.map((m) => (
        <MapDebrisLayer key={`${m.id}-${m.breachFx?.id ?? ''}`} map={m} />
      ))}
    </group>
  );
}
