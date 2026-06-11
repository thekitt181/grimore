import { useMemo, useEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { modelFormatFromUrl } from '@/lib/modelFormats';
import { useResolvedModelUrl } from './useResolvedModelUrl';

function normalizeRoot(root: THREE.Object3D, targetSize: number, groundAlign: boolean) {
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  root.scale.multiplyScalar(targetSize / maxDim);

  box.setFromObject(root);
  const center = box.getCenter(new THREE.Vector3());
  root.position.x -= center.x;
  root.position.z -= center.z;
  if (groundAlign) {
    box.setFromObject(root);
    root.position.y -= box.min.y;
  } else {
    root.position.y -= center.y;
  }
}

function GltfModel({
  url,
  targetSize,
  groundAlign,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
}) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    normalizeRoot(root, targetSize, groundAlign);
    return root;
  }, [scene, targetSize, groundAlign]);

  useEffect(() => () => {
    clone.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else mat?.dispose();
      }
    });
  }, [clone]);

  return <primitive object={clone} />;
}

function StlModel({
  url,
  targetSize,
  groundAlign,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
}) {
  const geometry = useLoader(STLLoader, url);
  const mesh = useMemo(() => {
    const geo = geometry.clone();
    geo.computeVertexNormals();
    const root = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({ color: '#c9a84c', roughness: 0.55, metalness: 0.15 }),
    );
    root.castShadow = true;
    root.receiveShadow = true;
    normalizeRoot(root, targetSize, groundAlign);
    return root;
  }, [geometry, targetSize, groundAlign]);

  return <primitive object={mesh} />;
}

/** Load GLB/GLTF/STL and scale to a target world size (max axis). */
export function SceneModel({
  url,
  targetSize,
  groundAlign = true,
}: {
  url: string;
  targetSize: number;
  groundAlign?: boolean;
}) {
  const resolvedUrl = useResolvedModelUrl(url);
  const format = modelFormatFromUrl(url);
  if (!format || !resolvedUrl) return null;
  if (format === 'stl') {
    return <StlModel url={resolvedUrl} targetSize={targetSize} groundAlign={groundAlign} />;
  }
  return <GltfModel url={resolvedUrl} targetSize={targetSize} groundAlign={groundAlign} />;
}
