import { useMemo, useEffect, useLayoutEffect, Suspense } from 'react';
import { useLoader } from '@react-three/fiber';
import { useFBX, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { modelFormatFromUrl } from '@/lib/modelFormats';
import { useResolvedModelUrl } from './useResolvedModelUrl';
import { registerMapRaycastRoot } from './mapGroundRaycast';
import { applyModelNormalization, applyFallbackModelNormalization } from './normalizeModelRoot';
import { alignTokenSoleOnce } from './tokenFootPlant';
import { useTokenGroundedLocomotion } from './useTokenGroundedLocomotion';
import {
  SHARED_MIXAMO_WALK_URL,
  retargetMixamoClipToSkeleton,
} from './retargetMixamoWalk';
import { rootHasSkinnedMesh } from './tokenSmartRig';
import { enhancePropMaterials } from './propMaterialEnhance';
// Warm the Mixamo walk pack so token Suspense rarely stalls on first place.
useFBX.preload(SHARED_MIXAMO_WALK_URL);

function configureMapMesh(mesh: THREE.Mesh): void {
  mesh.frustumCulled = false;
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const mat of mats) {
    mat.side = THREE.DoubleSide;
    // Keep depthWrite on — shared GLTF materials must not stay softened from an underlay.
    mat.depthWrite = true;
  }
}

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
  /** Tokens only: one-shot sole align after normalize (not per-frame plant). */
  soleAlign = false,
  tokenUpright = false,
) {
  useLayoutEffect(() => {
    const normKey = `${targetSize}|${footprint?.width ?? ''}|${footprint?.height ?? ''}|${groundAlign ? 1 : 0}|up2|grnd1|${tokenUpright ? 1 : 0}`;
    // Skip destructive re-normalize when this root is already fitted (e.g. after a drag re-render).
    if (root.userData.__grimoireNormKey === normKey) {
      root.visible = true;
      return;
    }

    // Hide tokens until sized. Maps/props stay visible so wall raycasts and dungeon
    // props work as soon as the mesh is parented (hiding maps made meshBlocksMove miss).
    if (soleAlign) root.visible = false;

    let normTries = 0;
    let soleTries = 0;
    let frameId = 0;
    let cancelled = false;
    let normalized = false;
    const maxNormTries = footprint ? 120 : 24;

    const reveal = () => {
      root.visible = true;
      root.userData.__grimoireNormKey = normKey;
    };

    const tick = () => {
      if (cancelled) return;

      if (!normalized) {
        // Bounds are wrong until the primitive is parented into the scene.
        if (!root.parent) {
          if (normTries++ > 180) {
            // Don't leave tokenRender props/minis stuck invisible forever.
            applyFallbackModelNormalization(root, targetSize, groundAlign);
            normalized = true;
            reveal();
            return;
          }
          frameId = requestAnimationFrame(tick);
          return;
        }

        if (applyModelNormalization(root, targetSize, groundAlign, footprint, tokenUpright)) {
          normalized = true;
          reveal();
        } else if (normTries++ < maxNormTries) {
          frameId = requestAnimationFrame(tick);
          return;
        } else if (footprint) {
          // Maps: keep retrying (CAD-scale fallback nests a mini copy). Props/tokens:
          // eventually fall back so they don't stay hidden after tokenRender hide.
          if (normTries < maxNormTries + 90) {
            frameId = requestAnimationFrame(tick);
            return;
          }
          applyFallbackModelNormalization(root, targetSize, groundAlign);
          normalized = true;
          reveal();
          return;
        } else {
          applyFallbackModelNormalization(root, targetSize, groundAlign);
          normalized = true;
          reveal();
        }
      }

      // One-shot sole align only — do not re-run normalize (that would undo the shift).
      if (soleAlign) {
        if (alignTokenSoleOnce(root)) return;
        if (soleTries++ < 16) {
          frameId = requestAnimationFrame(tick);
        }
      }
    };

    tick();
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [root, targetSize, groundAlign, footprint?.width, footprint?.height, soleAlign, tokenUpright]);
}

function GltfModel({
  url,
  targetSize,
  groundAlign,
  registerRaycast,
  tokenRender,
  propRender = false,
  tokenRender2d,
  footprint,
  itemId,
  collisionMap,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
  registerRaycast?: boolean;
  tokenRender?: boolean;
  propRender?: boolean;
  tokenRender2d?: boolean;
  footprint?: { width: number; height: number };
  itemId?: string;
  collisionMap?: import('@/systems/scene/types').MapItem;
}) {
  const { scene, animations } = useGLTF(url);
  // Sole align + locomotion only for real tokens (itemId). Props use tokenRender for materials only.
  const isTokenMini = !!tokenRender && !!itemId;
  const clone = useMemo(() => {
    // Skinned GLBs need SkeletonUtils.clone or walk/idle clips bind to the wrong bones.
    const hasSkinned = animations.length > 0 || (() => {
      let skinned = false;
      scene.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
      });
      return skinned;
    })();
    const root = (hasSkinned ? cloneSkinned(scene) : scene.clone(true)) as THREE.Object3D;
    // Hide only token minis until sole-align. Props share tokenRender materials but must
    // stay visible — they have no itemId, so soleAlign never reveals them otherwise.
    if (isTokenMini) root.visible = false;
    root.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        mesh.castShadow = true;
        mesh.receiveShadow = propRender || !tokenRender;
        if (tokenRender || propRender) {
          mesh.renderOrder = propRender ? 11 : 12;
          mesh.frustumCulled = false;
        } else {
          configureMapMesh(mesh);
        }
      }
    });
    if (propRender) enhancePropMaterials(root);
    else if (tokenRender) brightenMeshMaterials(root, tokenRender2d, true);
    return root;
  }, [scene, animations.length, tokenRender, propRender, tokenRender2d, isTokenMini]);

  useNormalizedModel(clone, targetSize, groundAlign, footprint, isTokenMini, isTokenMini);

  useEffect(() => {
    if (!registerRaycast || tokenRender) return;
    return registerMapRaycastRoot(clone, collisionMap);
  }, [clone, registerRaycast, tokenRender, collisionMap]);

  // Detach on unmount so Strict Mode / 2D↔3D remounts cannot leave an orphan nest.
  // Never dispose clone geometry/materials — shared with useGLTF cache (wipes maps/tokens).
  useEffect(() => () => {
    clone.removeFromParent();
  }, [clone]);

  return (
    <>
      <primitive object={clone} />
      {isTokenMini ? (
        <Suspense fallback={null}>
          <TokenMixamoWalkDriver root={clone} embedded={animations} itemId={itemId} />
        </Suspense>
      ) : null}
    </>
  );
}

/** Loads shared Mixamo walk FBX and retargets onto this token's skeleton. */
function TokenMixamoWalkDriver({
  root,
  embedded,
  itemId,
}: {
  root: THREE.Object3D;
  embedded: THREE.AnimationClip[];
  itemId?: string;
}) {
  const fbx = useFBX(SHARED_MIXAMO_WALK_URL);

  const clips = useMemo(() => {
    // Motion / Meshy GLBs: never override authored clips with shared Mixamo retarget.
    if (embedded.length > 0) return embedded;

    const src = fbx.animations[0];
    if (!src) return embedded;

    // Legacy auto-rig exports (Mixamo names, no clips) deform badly with retargeted walk.
    let mixamorigOnly = true;
    let boneCount = 0;
    root.traverse((o) => {
      if (!(o as THREE.Bone).isBone) return;
      boneCount += 1;
      if (!/^mixamorig/i.test(o.name)) mixamorigOnly = false;
    });
    if (boneCount >= 8 && mixamorigOnly && rootHasSkinnedMesh(root)) {
      return [];
    }

    const retargeted = retargetMixamoClipToSkeleton(src, root);
    if (retargeted) return [retargeted];
    return embedded;
  }, [fbx.animations, root, embedded]);

  useTokenGroundedLocomotion(root, clips, true, itemId);
  return null;
}

function StlModel({
  url,
  targetSize,
  groundAlign,
  registerRaycast,
  tokenRender,
  tokenRender2d,
  footprint,
  collisionMap,
}: {
  url: string;
  targetSize: number;
  groundAlign: boolean;
  registerRaycast?: boolean;
  tokenRender?: boolean;
  tokenRender2d?: boolean;
  footprint?: { width: number; height: number };
  collisionMap?: import('@/systems/scene/types').MapItem;
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
    } else {
      configureMapMesh(root);
    }
    return root;
  }, [geometry, tokenRender, tokenRender2d]);

  useNormalizedModel(mesh, targetSize, groundAlign, footprint);

  useEffect(() => {
    if (!registerRaycast || tokenRender) return;
    return registerMapRaycastRoot(mesh, collisionMap);
  }, [mesh, registerRaycast, tokenRender, collisionMap]);

  useEffect(() => () => {
    mesh.removeFromParent();
  }, [mesh]);

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
  itemId,
  propRender = false,
  collisionMap,
}: {
  url: string;
  targetSize: number;
  groundAlign?: boolean;
  /** Register mesh for token ground-height raycasts (map models only). */
  registerRaycast?: boolean;
  /** Brighter materials + render on top of map geometry (tokens). */
  tokenRender?: boolean;
  /** Textured dungeon props (KayKit GLB). */
  propRender?: boolean;
  footprint?: { width: number; height: number };
  /** Token id — enables grounded idle/walk (hip Y stripped). Maps omit this. */
  itemId?: string;
  /** When set with registerRaycast — bake O(1) FP collision grid from this map. */
  collisionMap?: import('@/systems/scene/types').MapItem;
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
          {...(collisionMap ? { collisionMap } : {})}
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
        {...(itemId ? { itemId } : {})}
        {...(footprint ? { footprint } : {})}
        propRender={propRender}
        {...(collisionMap ? { collisionMap } : {})}
      />
    </Suspense>
  );
}
