import * as THREE from 'three';

const MAX_ANISO = 16;

/** Shared PBR defaults for procedural prop primitives. */
export function propMaterialProps(opts: {
  color: string;
  roughness?: number;
  metalness?: number;
  emissive?: string;
  emissiveIntensity?: number;
}): {
  color: string;
  roughness: number;
  metalness: number;
  envMapIntensity: number;
  flatShading: boolean;
  emissive?: string;
  emissiveIntensity?: number;
} {
  return {
    color: opts.color,
    roughness: opts.roughness ?? 0.68,
    metalness: opts.metalness ?? 0.08,
    envMapIntensity: 1.32,
    flatShading: false,
    ...(opts.emissive ? { emissive: opts.emissive, emissiveIntensity: opts.emissiveIntensity ?? 0 } : {}),
  };
}

function tuneTexture(tex: THREE.Texture, isColor = false): void {
  tex.anisotropy = MAX_ANISO;
  if (isColor) tex.colorSpace = THREE.SRGBColorSpace;
  if (tex.image && typeof (tex.image as { width?: number }).width === 'number') {
    const w = (tex.image as { width: number }).width;
    const h = (tex.image as { height: number }).height;
    if (w >= 4 && h >= 4) {
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
    }
  }
}

/** Tune one standard/physical material for dungeon props (GLB + shared helper). */
export function tunePropStandardMaterial(mat: THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial): void {
  // Don't zero author emissive on glow props — only kill residual black emissive boost.
  if (mat.emissiveIntensity > 0 && mat.emissive.getHex() === 0) {
    mat.emissiveIntensity = 0;
  }
  mat.envMapIntensity = Math.max(mat.envMapIntensity, 1.28);
  mat.flatShading = false;

  mat.roughness = THREE.MathUtils.clamp(mat.roughness * 0.88 + 0.05, 0.26, 0.94);
  mat.metalness = THREE.MathUtils.clamp(mat.metalness, 0, 0.92);

  if (mat instanceof THREE.MeshPhysicalMaterial) {
    mat.clearcoat = THREE.MathUtils.clamp(mat.clearcoat, 0, 0.35);
    mat.clearcoatRoughness = THREE.MathUtils.clamp(mat.clearcoatRoughness, 0.15, 0.85);
    if (mat.metalness > 0.45 && mat.clearcoat < 0.08) {
      mat.clearcoat = 0.12;
      mat.clearcoatRoughness = 0.42;
    }
  }

  const maps = [
    mat.map,
    mat.normalMap,
    mat.roughnessMap,
    mat.metalnessMap,
    mat.aoMap,
    mat.emissiveMap,
    mat.alphaMap,
  ].filter(Boolean) as THREE.Texture[];
  for (const tex of maps) {
    tuneTexture(tex, tex === mat.map || tex === mat.emissiveMap);
  }

  if (mat.normalMap && mat.normalScale.x < 0.9) {
    mat.normalScale.set(1, 1);
  }

  // KayKit often flags transparent without real alpha — raising alphaTest made chests vanish.
  // Only cutout when there is an alpha map or partial opacity.
  if (mat.alphaMap || (mat.transparent && mat.opacity < 0.98)) {
    mat.side = THREE.DoubleSide;
    if (mat.alphaMap && mat.alphaTest < 0.08) mat.alphaTest = 0.08;
  } else {
    mat.transparent = false;
    mat.alphaTest = 0;
    mat.depthWrite = true;
  }

  mat.needsUpdate = true;
}

/** Realistic PBR tuning for KayKit / GLB dungeon props (no token emissive boost). */
export function enhancePropMaterials(root: THREE.Object3D): void {
  root.traverse((child) => {
    if (!(child as THREE.Mesh).isMesh) return;
    const mesh = child as THREE.Mesh;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const nextMats = mats.map((raw) => {
      // Clone so we never mutate the shared useGLTF material cache.
      if (raw instanceof THREE.MeshStandardMaterial || raw instanceof THREE.MeshPhysicalMaterial) {
        const cloned = raw.clone();
        tunePropStandardMaterial(cloned);
        return cloned;
      }
      if (raw instanceof THREE.MeshLambertMaterial || raw instanceof THREE.MeshPhongMaterial) {
        const alphaMap =
          'alphaMap' in raw ? (raw as THREE.MeshPhongMaterial).alphaMap : null;
        const std = new THREE.MeshStandardMaterial({
          map: raw.map,
          color: raw.color.clone(),
          transparent: raw.transparent,
          opacity: raw.opacity,
          side: raw.side,
          ...(alphaMap ? { alphaMap } : {}),
        });
        tunePropStandardMaterial(std);
        return std;
      }
      return raw;
    });
    mesh.material = nextMats.length === 1 ? nextMats[0]! : nextMats;
  });
}
