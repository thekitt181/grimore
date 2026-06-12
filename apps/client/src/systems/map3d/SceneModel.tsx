import { useMemo, useEffect, useLayoutEffect } from 'react';
import { useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { modelFormatFromUrl } from '@/lib/modelFormats';
import { useResolvedModelUrl } from './useResolvedModelUrl';
import { registerMapRaycastRoot } from './mapGroundRaycast';
import { applyModelNormalization, applyFallbackModelNormalization } from './normalizeModelRoot';

function brightenMeshMaterials(root: THREE.Object3D) {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.envMapIntensity = 1.2;
      if (mat.emissiveIntensity < 0.08) {
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = 0.08;
      }
    }
  });
}

function useNormalizedModel(
  root: THREE.Object3D,
  targetSize: number,
  groundAlign: boolean,
) {
  useLayoutEffect(() => {
    if (applyModelNormalization(root, targetSize, groundAlign)) return;

    let attempts = 0;
    let frameId = 0;
    const retry = () => {
      if (applyModelNormalization(root, targetSize, groundAlign)) return;
      if (attempts++ >= 8) {
        applyFallbackModelNormalization(root, targetSize, groundAlign);
        return;
      }
      frameId = requestAnimationFrame(retry);
    };
    frameId = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(frameId);
  }, [root, targetSize, groundAlign]);
}

function GltfModel({
  url,
  targetSize,
  groundAlign,
  registerRaycast,
  tokenRender,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
  registerRaycast?: boolean;
  tokenRender?: boolean;
}) {
  const { scene } = useGLTF(url);
  const clone = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = !tokenRender;
        if (tokenRender) {
          mesh.renderOrder = 10;
        }
      }
    });
    if (tokenRender) brightenMeshMaterials(root);
    return root;
  }, [scene, tokenRender]);

  useNormalizedModel(clone, targetSize, groundAlign);

  useEffect(() => {
    if (!registerRaycast || tokenRender) return;
    return registerMapRaycastRoot(clone);
  }, [clone, registerRaycast, tokenRender]);

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
  registerRaycast,
  tokenRender,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
  registerRaycast?: boolean;
  tokenRender?: boolean;
}) {
  const geometry = useLoader(STLLoader, url);
  const mesh = useMemo(() => {
    const geo = geometry.clone();
    geo.computeVertexNormals();
    const root = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: '#c9a84c',
        roughness: 0.55,
        metalness: 0.15,
        emissive: '#3a3020',
        emissiveIntensity: 0.12,
      }),
    );
    root.castShadow = true;
    root.receiveShadow = !tokenRender;
    if (tokenRender) root.renderOrder = 10;
    return root;
  }, [geometry, tokenRender]);

  useNormalizedModel(mesh, targetSize, groundAlign);

  useEffect(() => {
    if (!registerRaycast || tokenRender) return;
    return registerMapRaycastRoot(mesh);
  }, [mesh, registerRaycast, tokenRender]);

  return <primitive object={mesh} />;
}

/** Load GLB/GLTF/STL and scale to a target world size (max axis). */
export function SceneModel({
  url,
  targetSize,
  groundAlign = true,
  registerRaycast = false,
  tokenRender = false,
}: {
  url: string;
  targetSize: number;
  groundAlign?: boolean;
  /** Register mesh for token ground-height raycasts (map models only). */
  registerRaycast?: boolean;
  /** Brighter materials + render on top of map geometry (tokens). */
  tokenRender?: boolean;
}) {
  const resolvedUrl = useResolvedModelUrl(url);
  const format = modelFormatFromUrl(url);
  if (!format || !resolvedUrl) return null;
  if (format === 'stl') {
    return (
      <StlModel
        url={resolvedUrl}
        targetSize={targetSize}
        groundAlign={groundAlign}
        registerRaycast={registerRaycast}
        tokenRender={tokenRender}
      />
    );
  }
  return (
    <GltfModel
      url={resolvedUrl}
      targetSize={targetSize}
      groundAlign={groundAlign}
      registerRaycast={registerRaycast}
      tokenRender={tokenRender}
    />
  );
}
