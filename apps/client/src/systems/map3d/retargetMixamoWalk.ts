import * as THREE from 'three';
import {
  detectHumanoidBonesByHierarchy,
  detectHumanoidBonesByName,
  normalizeBoneName,
  type BoneRole,
} from './tokenSmartRig';

/** Shared Mixamo walk packed next to token GLBs. */
export const SHARED_MIXAMO_WALK_URL = '/tokens3d/unarmed_walk_forward.fbx';

/** Letters-only key so Hips_00 and mixamorigHips both → "hips". */
export function boneLetters(name: string): string {
  return name
    .toLowerCase()
    .replace(/^mixamorig[:\s]*/i, '')
    .replace(/[^a-z]/g, '');
}

/** Mixamo clip node → semantic role. */
const MIXAMO_NODE_TO_ROLE: Array<[string, BoneRole]> = [
  ['mixamorigHips', 'hips'],
  ['mixamorigSpine', 'spine'],
  ['mixamorigSpine1', 'chest'],
  ['mixamorigSpine2', 'chest'],
  ['mixamorigNeck', 'neck'],
  ['mixamorigHead', 'head'],
  ['mixamorigLeftShoulder', 'leftUpperArm'],
  ['mixamorigLeftArm', 'leftUpperArm'],
  ['mixamorigLeftForeArm', 'leftLowerArm'],
  ['mixamorigLeftHand', 'leftLowerArm'],
  ['mixamorigRightShoulder', 'rightUpperArm'],
  ['mixamorigRightArm', 'rightUpperArm'],
  ['mixamorigRightForeArm', 'rightLowerArm'],
  ['mixamorigRightHand', 'rightLowerArm'],
  ['mixamorigLeftUpLeg', 'leftUpperLeg'],
  ['mixamorigLeftLeg', 'leftLowerLeg'],
  ['mixamorigLeftFoot', 'leftLowerLeg'],
  ['mixamorigLeftToeBase', 'leftLowerLeg'],
  ['mixamorigRightUpLeg', 'rightUpperLeg'],
  ['mixamorigRightLeg', 'rightLowerLeg'],
  ['mixamorigRightFoot', 'rightLowerLeg'],
  ['mixamorigRightToeBase', 'rightLowerLeg'],
];

/** Joints for retarget — GLTF often uses named Object3D nodes, not only THREE.Bone. */
function collectJoints(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  const seen = new Set<string>();
  const add = (o: THREE.Object3D) => {
    if (!o?.name || seen.has(o.uuid)) return;
    seen.add(o.uuid);
    out.push(o);
  };

  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) add(o);
    const sk = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : null;
    if (sk) {
      for (const b of sk.bones) add(b);
    }
  });

  // Meshy / Arcade-style rigs: Hips, LeftArm, etc. on the node tree.
  root.traverse((o) => {
    if (!o.name || /mesh_\d/i.test(o.name)) return;
    const norm = normalizeBoneName(o.name);
    if (!norm || norm.length < 3) return;
    if (
      /^(hips|spine|neck|head|left|right|pelvis|armature)/.test(norm)
      || norm.includes('upleg')
      || norm.includes('forearm')
      || norm.includes('shoulder')
    ) {
      add(o);
    }
  });

  return out;
}

function collectBones(root: THREE.Object3D): THREE.Bone[] {
  return collectJoints(root).filter((o) => (o as THREE.Bone).isBone) as THREE.Bone[];
}

/**
 * Map Mixamo track node names onto a target skeleton.
 * Spines are ordered by world-Y (lowest = near hips = mixamorigSpine).
 */
export function buildMixamoRetargetMap(root: THREE.Object3D): Map<string, string> {
  const joints = collectJoints(root);
  const map = new Map<string, string>();
  if (joints.length === 0) return map;

  root.updateWorldMatrix(true, true);
  const byLetters = new Map<string, THREE.Object3D[]>();
  for (const b of joints) {
    const key = boneLetters(b.name);
    if (!key) continue;
    const list = byLetters.get(key) ?? [];
    list.push(b);
    byLetters.set(key, list);
  }

  const pick = (key: string): string | undefined => {
    const list = byLetters.get(key);
    if (!list?.length) return undefined;
    return list[0]!.name;
  };

  const exact: Array<[string, string]> = [
    ['hips', 'mixamorigHips'],
    ['neck', 'mixamorigNeck'],
    ['head', 'mixamorigHead'],
    ['leftshoulder', 'mixamorigLeftShoulder'],
    ['leftarm', 'mixamorigLeftArm'],
    ['leftforearm', 'mixamorigLeftForeArm'],
    ['lefthand', 'mixamorigLeftHand'],
    ['rightshoulder', 'mixamorigRightShoulder'],
    ['rightarm', 'mixamorigRightArm'],
    ['rightforearm', 'mixamorigRightForeArm'],
    ['righthand', 'mixamorigRightHand'],
    ['leftupleg', 'mixamorigLeftUpLeg'],
    ['leftleg', 'mixamorigLeftLeg'],
    ['leftfoot', 'mixamorigLeftFoot'],
    ['lefttoebase', 'mixamorigLeftToeBase'],
    ['rightupleg', 'mixamorigRightUpLeg'],
    ['rightleg', 'mixamorigRightLeg'],
    ['rightfoot', 'mixamorigRightFoot'],
    ['righttoebase', 'mixamorigRightToeBase'],
  ];

  for (const [key, mixamo] of exact) {
    const target = pick(key);
    if (target) map.set(mixamo, target);
  }

  // Spines: all bones whose letters contain "spine", lowest Y first.
  const spines = joints
    .filter((b) => boneLetters(b.name).includes('spine'))
    .map((b) => {
      const p = new THREE.Vector3();
      b.getWorldPosition(p);
      return { b, y: p.y };
    })
    .sort((a, c) => a.y - c.y);

  const mixamoSpines = ['mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2'];
  for (let i = 0; i < mixamoSpines.length && i < spines.length; i++) {
    map.set(mixamoSpines[i]!, spines[i]!.b.name);
  }

  // Semantic detector (Mixamo / VRM / Meshy naming).
  let roles = detectHumanoidBonesByName(root);
  if (!roles.hips || !roles.leftUpperLeg) {
    roles = { ...detectHumanoidBonesByHierarchy(root), ...roles };
  }
  for (const [mixamo, role] of MIXAMO_NODE_TO_ROLE) {
    const joint = roles[role];
    if (joint?.name) map.set(mixamo, joint.name);
  }

  // Already-Mixamo targets: identity map for any mixamorig* bone present.
  for (const b of joints) {
    if (/^mixamorig/i.test(b.name)) map.set(b.name, b.name);
  }

  return map;
}

/** Map clip source nodes onto token joints by name similarity. */
export function extendRetargetMapFromClip(
  map: Map<string, string>,
  clip: THREE.AnimationClip,
  root: THREE.Object3D,
): Map<string, string> {
  const out = new Map(map);
  const byLetters = new Map<string, string>();
  for (const j of collectJoints(root)) {
    const key = boneLetters(j.name);
    if (key && !byLetters.has(key)) byLetters.set(key, j.name);
  }
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const src = track.name.slice(0, dot);
    if (out.has(src)) continue;
    const key = boneLetters(src);
    const hit = byLetters.get(key);
    if (hit) out.set(src, hit);
  }
  return out;
}

function retargetClipWithMap(
  clip: THREE.AnimationClip,
  rename: Map<string, string>,
  outName: string,
): THREE.AnimationClip | null {
  const tracks: THREE.KeyframeTrack[] = [];
  for (const track of clip.tracks) {
    const dot = track.name.lastIndexOf('.');
    if (dot < 0) continue;
    const node = track.name.slice(0, dot);
    const prop = track.name.slice(dot + 1);
    const dest = rename.get(node);
    if (!dest) continue;
    const next = track.clone();
    next.name = `${dest}.${prop}`;
    tracks.push(next);
  }
  const bound = new Set(tracks.map((t) => t.name.split('.')[0]));
  const letters = [...bound].map((n) => boneLetters(n ?? ''));
  const hasHips = letters.some((k) => k.includes('hips') || k.includes('pelvis'));
  const hasLLeg = letters.some((k) => k.includes('leftupleg') || k.includes('leftleg'));
  const hasRLeg = letters.some((k) => k.includes('rightupleg') || k.includes('rightleg'));
  if (!hasHips || !hasLLeg || !hasRLeg || tracks.length < 12) return null;
  return new THREE.AnimationClip(outName, clip.duration, tracks, clip.blendMode);
}

/**
 * Rename Mixamo clip tracks onto `root` bones. Drops finger / unmatched tracks.
 * Returns null if too few tracks bind (not a usable humanoid match).
 */
export function retargetMixamoClipToSkeleton(
  clip: THREE.AnimationClip,
  root: THREE.Object3D,
): THREE.AnimationClip | null {
  let rename = buildMixamoRetargetMap(root);
  rename = extendRetargetMapFromClip(rename, clip, root);
  if (rename.size < 4) return null;
  return retargetClipWithMap(clip, rename, 'walk_unarmed_forward');
}
