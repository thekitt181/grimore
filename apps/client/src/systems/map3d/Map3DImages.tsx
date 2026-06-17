import { useRef } from 'react';
import * as THREE from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useMapStore } from '@/systems/map/store/mapStore';
import type { ImageItem } from '@/systems/scene/types';
import { useThreeTexture } from './useThreeTexture';
import { SceneItemTransformGroup } from './TokenTransformGroup';
import { TokenNameLabel } from './TokenNameLabel';

function MapImageMesh({ item }: { item: ImageItem }) {
  const { texture } = useThreeTexture(item.imageUrl);
  const meshBase = useRef({ w: item.width, h: item.height });
  if (meshBase.current.w !== item.width || meshBase.current.h !== item.height) {
    meshBase.current = { w: item.width, h: item.height };
  }
  const footprint = Math.min(meshBase.current.w, meshBase.current.h);

  return (
    <SceneItemTransformGroup
      itemId={item.id}
      surfaceY={0.06}
      baseWidth={meshBase.current.w}
      baseHeight={meshBase.current.h}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]} renderOrder={9}>
        <planeGeometry args={[meshBase.current.w, meshBase.current.h]} />
        <meshStandardMaterial
          {...(texture ? { map: texture } : {})}
          color={texture ? '#ffffff' : '#1c1c28'}
          transparent
          roughness={0.65}
          metalness={0.05}
          side={THREE.DoubleSide}
        />
      </mesh>
      <TokenNameLabel name={item.name} footprint={footprint} />
    </SceneItemTransformGroup>
  );
}

export function Map3DImages({ images }: { images: ImageItem[] }) {
  if (images.length === 0) return null;
  return (
    <group>
      {images.map((item) => (
        <MapImageMesh key={item.id} item={item} />
      ))}
    </group>
  );
}

/** Live list of map images for the active scene. */
export function Map3DImageLayer() {
  const viewMode = useMapStore((s) => s.viewMode);
  const items = useItemStore((s) => s.items);
  if (viewMode !== '3d') return null;
  const images = Object.values(items).filter((i): i is ImageItem => i.type === 'image' && i.visible !== false);
  return <Map3DImages images={images} />;
}
