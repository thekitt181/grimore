import * as THREE from 'three';

/** Canonical humanoid roles we know how to drive. */
export type BoneRole =
  | 'hips'
  | 'spine'
  | 'chest'
  | 'neck'
  | 'head'
  | 'leftUpperArm'
  | 'rightUpperArm'
  | 'leftLowerArm'
  | 'rightLowerArm'
  | 'leftUpperLeg'
  | 'rightUpperLeg'
  | 'leftLowerLeg'
  | 'rightLowerLeg';

export type BoneMap = Partial<Record<BoneRole, THREE.Object3D>>;

/** Semantic clip slots driven by token state. */
export type ClipRole = 'idle' | 'walk' | 'run' | 'attack' | 'hit' | 'death' | 'cast' | 'emote';

export type ClipCatalog = Partial<Record<ClipRole, THREE.AnimationClip>>;

const ROLE_ALIASES: Record<BoneRole, string[]> = {
  hips: ['hips', 'pelvis', 'hip', 'root_hips', 'bip01_pelvis', 'j_bip_c_hips', 'c_hips', 'cog', 'centre'],
  spine: ['spine', 'spine1', 'spine_01', 'bip01_spine', 'j_bip_c_spine', 'c_spine'],
  chest: ['spine2', 'spine3', 'chest', 'spine_02', 'spine_03', 'upperchest', 'j_bip_c_chest', 'c_chest', 'torso'],
  neck: ['neck', 'neck_01', 'bip01_neck', 'j_bip_c_neck', 'c_neck'],
  head: ['head', 'head_01', 'bip01_head', 'j_bip_c_head', 'c_head'],
  leftUpperArm: [
    'leftarm', 'leftupperarm', 'upperarm_l', 'arm_l', 'l_upperarm', 'left_shoulder', 'leftshoulder',
    'mixamorigleftarm', 'bip01_l_upperarm', 'j_bip_l_upperarm', 'shoulder.l', 'upper_arm.l',
  ],
  rightUpperArm: [
    'rightarm', 'rightupperarm', 'upperarm_r', 'arm_r', 'r_upperarm', 'right_shoulder', 'rightshoulder',
    'mixamorigrightarm', 'bip01_r_upperarm', 'j_bip_r_upperarm', 'shoulder.r', 'upper_arm.r',
  ],
  leftLowerArm: [
    'leftforearm', 'leftlowerarm', 'lowerarm_l', 'forearm_l', 'l_forearm',
    'mixamorigleftforearm', 'bip01_l_forearm', 'j_bip_l_lowerarm', 'forearm.l',
  ],
  rightLowerArm: [
    'rightforearm', 'rightlowerarm', 'lowerarm_r', 'forearm_r', 'r_forearm',
    'mixamorigrightforearm', 'bip01_r_forearm', 'j_bip_r_lowerarm', 'forearm.r',
  ],
  leftUpperLeg: [
    'leftupleg', 'leftthigh', 'upperleg_l', 'thigh_l', 'l_upleg', 'leftupperleg',
    'mixamorigleftupleg', 'bip01_l_thigh', 'j_bip_l_upperleg', 'thigh.l', 'upleg.l',
  ],
  rightUpperLeg: [
    'rightupleg', 'rightthigh', 'upperleg_r', 'thigh_r', 'r_upleg', 'rightupperleg',
    'mixamorigrightupleg', 'bip01_r_thigh', 'j_bip_r_upperleg', 'thigh.r', 'upleg.r',
  ],
  leftLowerLeg: [
    'leftleg', 'leftlowerleg', 'lowerleg_l', 'calf_l', 'l_leg', 'leftshin',
    'mixamorigleftleg', 'bip01_l_calf', 'j_bip_l_lowerleg', 'shin.l', 'leg.l',
  ],
  rightLowerLeg: [
    'rightleg', 'rightlowerleg', 'lowerleg_r', 'calf_r', 'r_leg', 'rightshin',
    'mixamorigrightleg', 'bip01_r_calf', 'j_bip_r_lowerleg', 'shin.r', 'leg.r',
  ],
};

const CLIP_PATTERNS: Record<ClipRole, RegExp[]> = {
  idle: [/idle/, /stand/, /breath/, /wait/, /rest/, /neutral/, /loop$/],
  walk: [/\bwalk\b/, /walking/, /locomotion/, /move(?!ment)/],
  run: [/\brun\b/, /jog/, /sprint/, /dash/],
  attack: [/attack/, /slash/, /swing/, /punch/, /strike/, /melee/, /shoot/, /cast_attack/],
  hit: [/hit/, /hurt/, /damage/, /flinch/, /react/, /impact/, /take.?hit/],
  death: [/death/, /die/, /dead/, /ko\b/, /defeat/, /fall.?down/],
  cast: [/cast/, /spell/, /magic/, /channel/, /summon/],
  emote: [/wave/, /dance/, /cheer/, /emote/, /taunt/, /bow/, /clap/],
};

/** Strip common prefixes / separators so Mixamo / VRM / Blender names compare. */
export function normalizeBoneName(name: string): string {
  return name
    .toLowerCase()
    .replace(/^mixamorig[:\s]*/i, '')
    .replace(/^armature\|/i, '')
    .replace(/[^a-z0-9]+/g, '');
}

function matchRole(norm: string, role: BoneRole): boolean {
  return ROLE_ALIASES[role].some((alias) => {
    const a = normalizeBoneName(alias);
    return norm === a || (a.length >= 4 && norm.endsWith(a));
  });
}

export function rootHasSkinnedMesh(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) found = true;
  });
  return found;
}

function collectBones(root: THREE.Object3D): THREE.Bone[] {
  const bones: THREE.Bone[] = [];
  root.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone);
  });
  return bones;
}

/** Name-based mapping (Mixamo / VRM / Blender / CC / etc.). */
export function detectHumanoidBonesByName(root: THREE.Object3D): BoneMap {
  const map: BoneMap = {};
  const roles = Object.keys(ROLE_ALIASES) as BoneRole[];

  root.traverse((obj) => {
    if (!obj.name) return;
    const norm = normalizeBoneName(obj.name);
    if (!norm) return;
    for (const role of roles) {
      if (map[role]) continue;
      if (!matchRole(norm, role)) continue;
      map[role] = obj;
      break;
    }
  });

  return map;
}

/**
 * When names fail: pick a plausible hips + paired limbs from the skeleton hierarchy
 * using world Y (legs low, arms mid, head high).
 */
export function detectHumanoidBonesByHierarchy(root: THREE.Object3D): BoneMap {
  const bones = collectBones(root);
  if (bones.length < 4) return {};

  root.updateWorldMatrix(true, true);
  const withY = bones.map((b) => {
    const p = new THREE.Vector3();
    b.getWorldPosition(p);
    return { b, y: p.y, x: p.x };
  });
  withY.sort((a, c) => a.y - c.y);

  const map: BoneMap = {};
  // Lowest well-connected bone ≈ hips
  const hipsCand = withY.find((e) => e.b.children.length >= 2) ?? withY[0];
  if (hipsCand) map.hips = hipsCand.b;

  const mid = withY[Math.floor(withY.length * 0.45)];
  const high = withY[Math.floor(withY.length * 0.75)];
  const top = withY[withY.length - 1];
  if (mid) map.spine = mid.b;
  if (high) map.chest = high.b;
  if (top) map.head = top.b;

  const armBand = withY.filter((e) => {
    const t = (e.y - withY[0]!.y) / Math.max(1e-3, withY[withY.length - 1]!.y - withY[0]!.y);
    return t > 0.35 && t < 0.75;
  });
  const legBand = withY.filter((e) => {
    const t = (e.y - withY[0]!.y) / Math.max(1e-3, withY[withY.length - 1]!.y - withY[0]!.y);
    return t < 0.4;
  });

  const leftArm = armBand.filter((e) => e.x < 0).sort((a, c) => c.y - a.y)[0];
  const rightArm = armBand.filter((e) => e.x > 0).sort((a, c) => c.y - a.y)[0];
  const leftLeg = legBand.filter((e) => e.x < 0).sort((a, c) => c.y - a.y)[0];
  const rightLeg = legBand.filter((e) => e.x > 0).sort((a, c) => c.y - a.y)[0];

  if (leftArm) map.leftUpperArm = leftArm.b;
  if (rightArm) map.rightUpperArm = rightArm.b;
  if (leftLeg) map.leftUpperLeg = leftLeg.b;
  if (rightLeg) map.rightUpperLeg = rightLeg.b;

  // Child bones as lower limbs when present.
  if (leftArm?.b.children[0]) map.leftLowerArm = leftArm.b.children[0] as THREE.Object3D;
  if (rightArm?.b.children[0]) map.rightLowerArm = rightArm.b.children[0] as THREE.Object3D;
  if (leftLeg?.b.children[0]) map.leftLowerLeg = leftLeg.b.children[0] as THREE.Object3D;
  if (rightLeg?.b.children[0]) map.rightLowerLeg = rightLeg.b.children[0] as THREE.Object3D;

  return map;
}

/** Map a loaded token scene onto known humanoid bones (name first, hierarchy fallback). */
export function detectHumanoidBones(root: THREE.Object3D): BoneMap {
  const byName = detectHumanoidBonesByName(root);
  if (boneCoverage(byName) >= 4) return byName;
  const byHier = detectHumanoidBonesByHierarchy(root);
  return { ...byHier, ...byName };
}

export function boneCoverage(map: BoneMap): number {
  return Object.keys(map).length;
}

function scoreClipForRole(clip: THREE.AnimationClip, role: ClipRole): number {
  const n = clip.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  let score = 0;
  for (const re of CLIP_PATTERNS[role]) {
    if (re.test(n)) score += 10;
  }
  // Duration priors
  if (role === 'idle' && clip.duration >= 0.8 && clip.duration <= 12) score += 2;
  if ((role === 'walk' || role === 'run') && clip.duration >= 0.35 && clip.duration <= 4) score += 2;
  if ((role === 'attack' || role === 'hit' || role === 'cast') && clip.duration <= 3) score += 1;
  if (role === 'death' && clip.duration >= 0.5) score += 1;
  return score;
}

/** Classify every clip in the GLB into semantic roles (best match wins per role). */
export function buildClipCatalog(clips: THREE.AnimationClip[]): ClipCatalog {
  const catalog: ClipCatalog = {};
  const used = new Set<THREE.AnimationClip>();

  const order: ClipRole[] = ['death', 'hit', 'attack', 'cast', 'run', 'walk', 'idle', 'emote'];
  for (const role of order) {
    let best: THREE.AnimationClip | null = null;
    let bestScore = 0;
    for (const clip of clips) {
      if (used.has(clip)) continue;
      const s = scoreClipForRole(clip, role);
      if (s > bestScore) {
        bestScore = s;
        best = clip;
      }
    }
    // Thresholds: idle can be weaker; locomotion needs a clearer name match.
    const min = role === 'idle' ? 2 : role === 'emote' ? 8 : 8;
    if (best && bestScore >= min) {
      catalog[role] = best;
      used.add(best);
    }
  }

  // No named idle — use the longest leftover loop-ish clip.
  if (!catalog.idle) {
    const leftover = clips
      .filter((c) => !used.has(c))
      .sort((a, b) => b.duration - a.duration);
    if (leftover[0] && leftover[0].duration >= 0.6) {
      catalog.idle = leftover[0];
      used.add(leftover[0]);
    }
  }

  // No named walk — if we have run, treat it as walk; else first leftover short clip.
  if (!catalog.walk) {
    if (catalog.run) {
      catalog.walk = catalog.run;
    } else {
      const leftover = clips.filter((c) => !used.has(c) && c !== catalog.idle);
      const cand = leftover.find((c) => c.duration >= 0.35 && c.duration <= 5);
      if (cand) catalog.walk = cand;
    }
  }

  return catalog;
}

export type SmartRigMode = 'clips' | 'procedural' | 'none';

export type SmartRigPlan = {
  mode: SmartRigMode;
  bones: BoneMap;
  catalog: ClipCatalog;
  /** All clips to register on the mixer (full library). */
  mixerClips: THREE.AnimationClip[];
};

/**
 * Plan for any token GLB:
 * - clips present → drive mixer (even without a named skeleton)
 * - skeleton → procedural idle/walk fallback
 * - static mesh → no locomotion (never mesh-bob; feet stay planted)
 */
export function resolveSmartRigMode(
  root: THREE.Object3D,
  clips: THREE.AnimationClip[],
): SmartRigPlan {
  const bones = detectHumanoidBones(root);
  const catalog = buildClipCatalog(clips);
  const skinned = rootHasSkinnedMesh(root);
  const covered = boneCoverage(bones);
  const hasClips = clips.length > 0;

  if (hasClips) {
    return {
      mode: 'clips',
      bones,
      catalog,
      mixerClips: clips,
    };
  }
  if (skinned || covered >= 3) {
    return { mode: 'procedural', bones, catalog: {}, mixerClips: [] };
  }
  return { mode: 'none', bones: {}, catalog: {}, mixerClips: [] };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();

/** Drop T-pose arms into a relaxed A-pose (local Z, mirrored). */
export function applyRelaxedArmPose(bones: BoneMap): void {
  const drop = THREE.MathUtils.degToRad(72);
  if (bones.leftUpperArm) {
    _e.set(0, 0, drop);
    _q.setFromEuler(_e);
    bones.leftUpperArm.quaternion.multiply(_q);
  }
  if (bones.rightUpperArm) {
    _e.set(0, 0, -drop);
    _q.setFromEuler(_e);
    bones.rightUpperArm.quaternion.multiply(_q);
  }
  const bend = THREE.MathUtils.degToRad(12);
  if (bones.leftLowerArm) {
    _e.set(0, bend, 0);
    _q.setFromEuler(_e);
    bones.leftLowerArm.quaternion.multiply(_q);
  }
  if (bones.rightLowerArm) {
    _e.set(0, -bend, 0);
    _q.setFromEuler(_e);
    bones.rightLowerArm.quaternion.multiply(_q);
  }
}

export type ProceduralRigState = {
  bones: BoneMap;
  rest: Map<THREE.Object3D, THREE.Quaternion>;
  relaxed: boolean;
};

export function createProceduralRigState(bones: BoneMap): ProceduralRigState {
  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const bone of Object.values(bones)) {
    if (!bone) continue;
    rest.set(bone, bone.quaternion.clone());
  }
  return { bones, rest, relaxed: false };
}

/**
 * Idle breathe + head sway; walk cycle while moving (speed scales gait).
 * Restores from captured rest each frame so we don't accumulate drift.
 */
export function tickProceduralRig(
  state: ProceduralRigState,
  time: number,
  moving: boolean,
  moveSpeed = 0,
): void {
  const { bones, rest } = state;
  if (!state.relaxed) {
    applyRelaxedArmPose(bones);
    for (const bone of Object.values(bones)) {
      if (!bone) continue;
      rest.set(bone, bone.quaternion.clone());
    }
    state.relaxed = true;
  }

  const breath = Math.sin(time * 1.7) * 0.025;
  const sway = Math.sin(time * 0.85) * 0.04;
  const nod = Math.sin(time * 0.55) * 0.03;

  const apply = (role: BoneRole, euler: THREE.Euler) => {
    const bone = bones[role];
    const base = bone ? rest.get(bone) : undefined;
    if (!bone || !base) return;
    _q.setFromEuler(euler);
    bone.quaternion.copy(base).multiply(_q);
  };

  apply('spine', new THREE.Euler(breath * 0.6, sway * 0.35, 0));
  apply('chest', new THREE.Euler(breath, sway * 0.5, 0));
  apply('neck', new THREE.Euler(nod * 0.5, sway * 0.8, 0));
  apply('head', new THREE.Euler(nod, sway, 0));

  if (moving) {
    const gaitRate = THREE.MathUtils.clamp(5.5 + moveSpeed * 0.045, 5.5, 11);
    const amp = THREE.MathUtils.clamp(0.32 + moveSpeed * 0.002, 0.32, 0.55);
    const gait = time * gaitRate;
    const swing = Math.sin(gait) * amp;
    const swingOpp = Math.sin(gait + Math.PI) * amp;
    apply('leftUpperLeg', new THREE.Euler(swing, 0, 0));
    apply('rightUpperLeg', new THREE.Euler(swingOpp, 0, 0));
    apply('leftLowerLeg', new THREE.Euler(Math.max(0, -swing) * 0.75, 0, 0));
    apply('rightLowerLeg', new THREE.Euler(Math.max(0, -swingOpp) * 0.75, 0, 0));
    apply('leftUpperArm', new THREE.Euler(swingOpp * 0.4, 0, 0));
    apply('rightUpperArm', new THREE.Euler(swing * 0.4, 0, 0));
    apply('hips', new THREE.Euler(0, Math.sin(gait) * 0.04, 0));
  }
}

/** World XZ speed from successive centers (px/sec in map space). */
export function measureMoveSpeed(
  prev: { x: number; z: number; t: number } | null,
  x: number,
  z: number,
  t: number,
): { speed: number; next: { x: number; z: number; t: number } } {
  const next = { x, z, t };
  if (!prev) return { speed: 0, next };
  const dt = Math.max(1e-3, t - prev.t);
  const dx = x - prev.x;
  const dz = z - prev.z;
  const speed = Math.hypot(dx, dz) / dt;
  return { speed, next };
}

export function tokenLooksDead(item: {
  hp?: number;
  conditions?: string[];
}): boolean {
  if ((item.hp ?? 1) <= 0) return true;
  const cond = (item.conditions ?? []).map((c) => c.toLowerCase());
  return cond.some((c) => /dead|unconscious|dying|defeated|incapacitated/.test(c));
}
