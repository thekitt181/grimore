import { useMemo, useEffect, useLayoutEffect, Suspense } from 'react';
import { useLoader } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { modelFormatFromUrl } from '@/lib/modelFormats';
import { useResolvedModelUrl } from './useResolvedModelUrl';
import { registerMapRaycastRoot } from './mapGroundRaycast';
import { applyModelNormalization, applyFallbackModelNormalization } from './normalizeModelRoot';

function brightenMeshMaterials(root: THREE.Object3D, miniature2d = false, tokenRender = false) {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
      mat.envMapIntensity = miniature2d ? 1.45 : 1.2;
      mat.roughness = miniature2d ? Math.min(mat.roughness, 0.68) : mat.roughness;
      const minEmissive = miniature2d ? 0.14 : 0.08;
      if (mat.emissiveIntensity < minEmissive) {
        mat.emissive.copy(mat.color);
        mat.emissiveIntensity = minEmissive;
      }
      if (tokenRender) {
        mat.depthWrite = true;
        mat.polygonOffset = true;
        mat.polygonOffsetFactor = -4;
        mat.polygonOffsetUnits = -4;
      }
    }
  });
}

function useNormalizedModel(
  root: THREE.Object3D,
  targetSize: number,
  groundAlign: boolean,
  footprint?: { width: number; height: number },
) {
  useLayoutEffect(() => {
    if (applyModelNormalization(root, targetSize, groundAlign, footprint)) return;

    let attempts = 0;
    let frameId = 0;
    const retry = () => {
      if (applyModelNormalization(root, targetSize, groundAlign, footprint)) return;
      if (attempts++ >= 8) {
        applyFallbackModelNormalization(root, targetSize, groundAlign);
        return;
      }
      frameId = requestAnimationFrame(retry);
    };
    frameId = requestAnimationFrame(retry);
    return () => cancelAnimationFrame(frameId);
  }, [root, targetSize, groundAlign, footprint?.width, footprint?.height]);
}

function GltfModel({
  url,
  targetSize,
  groundAlign,
  registerRaycast,
  tokenRender,
  tokenRender2d,
  footprint,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
  registerRaycast?: boolean;
  tokenRender?: boolean;
  tokenRender2d?: boolean;
  footprint?: { width: number; height: number };
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
          mesh.renderOrder = 12;
          mesh.frustumCulled = false;
        }
      }
    });
    if (tokenRender) brightenMeshMaterials(root, tokenRender2d, true);
    return root;
  }, [scene, tokenRender, tokenRender2d]);

  useNormalizedModel(clone, targetSize, groundAlign, footprint);

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
  tokenRender2d,
  footprint,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
  registerRaycast?: boolean;
  tokenRender?: boolean;
  tokenRender2d?: boolean;
  footprint?: { width: number; height: number };
}) {
  const geometry = useLoader(STLLoader, url);
  const mesh = useMemo(() => {
    const geo = geometry.clone();
    geo.computeVertexNormals();
    const root = new THREE.Mesh(
      geo,
      new THREE.MeshStandardMaterial({
        color: '#c9a84c',
        roughness: tokenRender2d ? 0.52 : 0.55,
        metalness: tokenRender2d ? 0.22 : 0.15,
        emissive: '#3a3020',
        emissiveIntensity: tokenRender2d ? 0.18 : 0.12,
      }),
    );
    root.castShadow = true;
    root.receiveShadow = !tokenRender;
    if (tokenRender) {
      root.renderOrder = 12;
      root.frustumCulled = false;
    }
    return root;
  }, [geometry, tokenRender, tokenRender2d]);

  useNormalizedModel(mesh, targetSize, groundAlign, footprint);

  useEffect(() => {
    if (!registerRaycast || tokenRender) return;
    return registerMapRaycastRoot(mesh);
  }, [mesh, registerRaycast, tokenRender]);

  return <primitive object={mesh} />;
}

function ModelPlaceholder({ targetSize, tokenRender }: { targetSize: number; tokenRender?: boolean }) {
  const h = Math.max(targetSize * 0.45, 12);
  const r = h * 0.38;
  return (
    <mesh position={[0, h / 2, 0]}>
      <cylinderGeometry args={[r * 0.92, r, h, 20]} />
      <meshStandardMaterial
        color={tokenRender ? '#c9a84c' : '#8a7a50'}
        roughness={0.45}
        metalness={0.25}
        emissive={tokenRender ? '#3a3020' : '#000000'}
        emissiveIntensity={tokenRender ? 0.15 : 0}
      />
    </mesh>
  );
}

/** Load GLB/GLTF/STL and scale to a target world size (max axis). */
export function SceneModel({
  url,
  targetSize,
  groundAlign = true,
  registerRaycast = false,
  tokenRender = false,
  tokenRender2d = false,
  footprint,
}: {
  url: string;
  targetSize: number;
  groundAlign?: boolean;
  /** Register mesh for token ground-height raycasts (map models only). */
  registerRaycast?: boolean;
  /** Brighter materials + render on top of map geometry (tokens). */
  tokenRender?: boolean;
  /** Extra contrast for GLB/STL minis on the 2D map overlay. */
  tokenRender2d?: boolean;
  /** Token footprint in local space (XZ) before transform-group scale. */
  footprint?: { width: number; height: number };
}) {
  const { resolved, status } = useResolvedModelUrl(url);
  const format = modelFormatFromUrl(url);

  useEffect(() => {
    if (!resolved || format === 'stl' || format == null) return;
    useGLTF.preload(resolved);
  }, [resolved, format]);

  if (!format) return null;

  if (status === 'loading') {
    return <ModelPlaceholder targetSize={targetSize} tokenRender={tokenRender} />;
  }

  if (status === 'error' || !resolved) {
    return <ModelPlaceholder targetSize={targetSize} tokenRender={tokenRender} />;
  }

  const fallback = <ModelPlaceholder targetSize={targetSize} tokenRender={tokenRender} />;

  if (format === 'stl') {
    return (
      <Suspense fallback={fallback}>
        <StlModel
          url={resolved}
          targetSize={targetSize}
          groundAlign={groundAlign}
          registerRaycast={registerRaycast}
          tokenRender={tokenRender}
          tokenRender2d={tokenRender2d}
          {...(footprint ? { footprint } : {})}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={fallback}>
      <GltfModel
        url={resolved}
        targetSize={targetSize}
        groundAlign={groundAlign}
        registerRaycast={registerRaycast}
        tokenRender={tokenRender}
        tokenRender2d={tokenRender2d}
        {...(footprint ? { footprint } : {})}
      />
    </Suspense>
  );
}
