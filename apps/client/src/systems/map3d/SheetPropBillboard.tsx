import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import * as THREE from 'three';
import type { ImageItem } from '@/systems/scene/types';
import { propArtById } from '@/systems/map/props/propArt';
import { ASSETS2D_CHEST_IDLE } from '@/systems/map/props/assets2dChestCatalog';
import { propPose } from '@/systems/map/props/propPose';
import { TokenPickVolume } from './TokenPickVolume';

const _world = new THREE.Vector3();

export function isSheetChestProp(propId: string | undefined): boolean {
  return Boolean(propId && propId in ASSETS2D_CHEST_IDLE);
}

/** 2D sprite-sheet chests (idle loop + lid-open) on a yaw billboard in 3D. */
export function SheetPropBillboard({
  item,
  propId,
  displayOnly = false,
}: {
  item: ImageItem;
  propId: string;
  displayOnly?: boolean;
}) {
  const art = propArtById(propId);
  const urls = art?.frames?.length ? art.frames : art?.rest ? [art.rest] : [];
  if (urls.length === 0) return null;
  return (
    <SheetPropBillboardInner
      item={item}
      propId={propId}
      urls={urls}
      displayOnly={displayOnly}
    />
  );
}

function SheetPropBillboardInner({
  item,
  propId,
  urls,
  displayOnly,
}: {
  item: ImageItem;
  propId: string;
  urls: string[];
  displayOnly: boolean;
}) {
  const maps = useTexture(urls);
  const list = useMemo(() => (Array.isArray(maps) ? maps : [maps]), [maps]);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const yawRef = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    for (const tex of list) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
    }
  }, [list]);

  useFrame(({ clock }) => {
    const g = yawRef.current;
    if (g) {
      g.getWorldPosition(_world);
      const dx = camera.position.x - _world.x;
      const dz = camera.position.z - _world.z;
      if (dx * dx + dz * dz >= 1e-6) {
        const parentYaw = g.parent ? g.parent.rotation.y : 0;
        g.rotation.y = Math.atan2(dx, dz) - parentYaw;
      }
    }
    const mat = matRef.current;
    if (!mat || list.length === 0) return;
    const idleN = Math.min(list.length, ASSETS2D_CHEST_IDLE[propId] ?? list.length);
    const opening = list.slice(idleN);
    const p = propPose(item, 0.7);
    let tex = list[0]!;
    if (p <= 0.001) {
      const i = Math.floor((clock.elapsedTime * 1000) / 90) % idleN;
      tex = list[i] ?? tex;
    } else if (opening.length === 0 || p >= 0.999) {
      tex = opening[opening.length - 1] ?? list[list.length - 1]!;
    } else {
      const i = Math.min(opening.length - 1, Math.round(p * (opening.length - 1)));
      tex = opening[i] ?? tex;
    }
    if (mat.map !== tex) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
  });

  const planeW = Math.max(item.width, 8);
  const planeH = Math.max(item.height, 8);
  const footprint = Math.max(planeW, planeH);
  const opacity = item.visible === false ? 0.35 : 1;
  const lockFacing =
    item.propMount === 'wall'
    || Math.abs(item.propPitch ?? 0) > 0.5
    || Math.abs(item.propRoll ?? 0) > 0.5;

  const ghost = opacity < 0.99;
  const plane = (
    <mesh position={[0, planeH / 2, 0]} renderOrder={14}>
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial
        ref={matRef}
        map={list[0]}
        color="#ffffff"
        transparent={ghost}
        opacity={opacity}
        side={THREE.DoubleSide}
        alphaTest={ghost ? 0.08 : 0.5}
        depthWrite={!ghost}
        toneMapped={false}
        premultipliedAlpha={false}
      />
    </mesh>
  );

  return (
    <>
      {lockFacing ? plane : <group ref={yawRef}>{plane}</group>}
      {!displayOnly && (
        <TokenPickVolume itemId={item.id} radius={footprint * 0.52} height={planeH} y={0} />
      )}
    </>
  );
}
