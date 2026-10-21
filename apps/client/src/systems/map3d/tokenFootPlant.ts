import * as THREE from 'three';

const _v = new THREE.Vector3();
const _parentWorld = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _feet = new THREE.Vector3();

function isFootBoneName(name: string): boolean {
  const n = name.toLowerCase();
  return /(foot|toe|heel|ankle|ball_l|ball_r)/.test(n);
}

function isHipBoneName(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Hips_00, mixamorigHips, Pelvis, etc.
  return n.includes('hips') || n.includes('pelvis');
}

function isRootMotionNodeName(name: string): boolean {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (
    isHipBoneName(name)
    || n === 'armature'
    || n === 'root'
    || n === 'rootnode'
    || n === 'rootjoint'
    || n === '_rootjoint'
    || n === 'scene'
    || n === 'bip01'
    || n.endsWith('root')
    || n.includes('rootmotion')
    || n.includes('rootjoint')
  );
}

export function findHipBone(root: THREE.Object3D): THREE.Object3D | null {
  let found: THREE.Object3D | null = null;
  root.traverse((o) => {
    if (found) return;
    if ((o as THREE.Bone).isBone && isHipBoneName(o.name)) found = o;
  });
  return found;
}

/** Lowest mesh vertex AABB bottom in world space (what the player actually sees). */
export function measureTokenMeshBottomWorldY(root: THREE.Object3D): number | null {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  let found = false;
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    if (b.isEmpty()) return;
    box.union(b);
    found = true;
  });
  return found ? box.min.y : null;
}

/** Lowest named foot-bone Y in world space. */
export function measureTokenFootWorldY(root: THREE.Object3D): number | null {
  root.updateMatrixWorld(true);
  let footMin = Infinity;
  let found = false;
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    if (!isFootBoneName(o.name)) return;
    o.getWorldPosition(_v);
    if (!Number.isFinite(_v.y)) return;
    footMin = Math.min(footMin, _v.y);
    found = true;
  });
  return found ? footMin : null;
}

/**
 * One-shot (not every frame): after normalize, shift the token so the visible
 * mesh floor (and foot bones if lower) sits on the parent origin.
 */
export function alignTokenSoleOnce(root: THREE.Object3D): boolean {
  const parent = root.parent;
  if (!parent) return false;

  const meshY = measureTokenMeshBottomWorldY(root);
  const boneY = measureTokenFootWorldY(root);
  let groundY = meshY;
  if (meshY != null && boneY != null) groundY = Math.min(meshY, boneY);
  else if (groundY == null) groundY = boneY;
  if (groundY == null || !Number.isFinite(groundY)) return false;

  parent.getWorldPosition(_parentWorld);
  if (!Number.isFinite(_parentWorld.y)) return false;

  const delta = _parentWorld.y - groundY;
  if (!Number.isFinite(delta) || Math.abs(delta) < 1e-4 || Math.abs(delta) > 80) return false;

  const sy = Math.abs(parent.scale.y) > 1e-6 ? parent.scale.y : 1;
  const nextY = root.position.y + delta / sy;
  if (!Number.isFinite(nextY) || Math.abs(nextY) > 500) return false;
  root.position.y = nextY;
  return true;
}

/**
 * Remove root-motion translation from clips so parent TokenTransformGroup owns XZ.
 * Only hips/root `.position` tracks — limb translations must stay (Mixamo/FBX walks).
 */
export function stripClipHipTranslation(
  clips: THREE.AnimationClip[],
  root: THREE.Object3D,
): THREE.AnimationClip[] {
  const kill = new Set<string>();
  if (root.name) kill.add(root.name);
  root.traverse((o) => {
    if (o.name && isRootMotionNodeName(o.name)) kill.add(o.name);
    if ((o as THREE.Bone).isBone && isHipBoneName(o.name)) kill.add(o.name);
  });
  for (const n of ['mixamorigHips', 'mixamorig:Hips', 'Hips', 'hips', 'Pelvis', 'pelvis', 'Armature', 'Root']) {
    kill.add(n);
  }

  return clips.map((clip) => {
    // Only strip true root-motion carriers. Sketchfab/FBX walks need limb
    // `.position` tracks — wiping all positions left a frozen A-pose.
    const tracks = clip.tracks.filter((track) => {
      const [node, prop] = track.name.split('.');
      if (prop !== 'position' || !node) return true;
      if (kill.has(node)) return false;
      return !isRootMotionNodeName(node);
    });
    if (tracks.length === clip.tracks.length) return clip;
    return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
  });
}

/** Per-frame (after mixer): kill horizontal root-motion; leave limb local motion. */
export function pinRootMotionHorizontal(root: THREE.Object3D): void {
  root.position.x = 0;
  root.position.z = 0;
  root.traverse((o) => {
    if (!(o as THREE.Bone).isBone && o.type !== 'Bone') return;
    if (!isHipBoneName(o.name) && !isRootMotionNodeName(o.name)) return;
    o.position.x = 0;
    o.position.z = 0;
  });
}

/**
 * After mixer: if the hip still drifts in world XZ away from the feet group,
 * shove the model root so the mesh travels with TokenTransformGroup.
 */
export function lockModelHorizontalToFeet(
  modelRoot: THREE.Object3D,
  feetGroup: THREE.Object3D,
): void {
  pinRootMotionHorizontal(modelRoot);
  feetGroup.updateMatrixWorld(true);
  modelRoot.updateMatrixWorld(true);

  feetGroup.getWorldPosition(_feet);
  const hip = findHipBone(modelRoot) ?? modelRoot;
  hip.getWorldPosition(_hip);

  const errX = _hip.x - _feet.x;
  const errZ = _hip.z - _feet.z;
  if (errX * errX + errZ * errZ < 0.25) return;

  // Feet group yaw-only — convert world XZ error into feet-local XZ.
  const yaw = feetGroup.rotation.y;
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);
  const localX = errX * cos - errZ * sin;
  const localZ = errX * sin + errZ * cos;
  modelRoot.position.x -= localX;
  modelRoot.position.z -= localZ;
}

/** @deprecated */
export function plantTokenFeet(_root: THREE.Object3D): void {}
