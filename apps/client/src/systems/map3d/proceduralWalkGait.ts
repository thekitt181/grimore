import * as THREE from 'three';

type LimbSlot =
  | 'hipL'
  | 'hipR'
  | 'kneeL'
  | 'kneeR'
  | 'footL'
  | 'footR'
  | 'armL'
  | 'armR'
  | 'foreL'
  | 'foreR'
  | 'spine'
  | 'chest';

type GaitRig = {
  bones: Partial<Record<LimbSlot, THREE.Object3D>>;
  rest: Map<THREE.Object3D, THREE.Quaternion>;
  /** Character forward in model space — Mixamo usually +Z after our 180° token yaw. */
  ready: boolean;
};

const SLOT_PATTERNS: Record<LimbSlot, RegExp[]> = {
  hipL: [/leftupleg/, /left_up_leg/, /thigh_l/, /l_thigh/, /upperleg_l/, /leftthigh/, /hip_l/],
  hipR: [/rightupleg/, /right_up_leg/, /thigh_r/, /r_thigh/, /upperleg_r/, /rightthigh/, /hip_r/],
  kneeL: [/leftleg$/, /left_leg$/, /calf_l/, /l_calf/, /lowerleg_l/, /leftshin/, /shin_l/, /leftknee/],
  kneeR: [/rightleg$/, /right_leg$/, /calf_r/, /r_calf/, /lowerleg_r/, /rightshin/, /shin_r/, /rightknee/],
  footL: [/leftfoot/, /foot_l/, /l_foot/, /leftankle/],
  footR: [/rightfoot/, /foot_r/, /r_foot/, /rightankle/],
  armL: [/leftarm$/, /left_arm$/, /upperarm_l/, /l_upperarm/, /shoulder_l/, /leftshoulder/],
  armR: [/rightarm$/, /right_arm$/, /upperarm_r/, /r_upperarm/, /shoulder_r/, /rightshoulder/],
  foreL: [/leftforearm/, /forearm_l/, /l_forearm/, /lowerarm_l/, /leftelbow/],
  foreR: [/rightforearm/, /forearm_r/, /r_forearm/, /lowerarm_r/, /rightelbow/],
  spine: [/^spine$/, /spine1/, /spine_01/, /mixamorigspine$/],
  chest: [/spine2/, /spine3/, /chest/, /spine_02/, /mixamorigspine2/],
};

function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function matchSlot(name: string, slot: LimbSlot): boolean {
  const n = normName(name);
  // Keep "mixamorig" prefix stripped for matching.
  const bare = n.replace(/^mixamorig/, '');
  return SLOT_PATTERNS[slot].some((re) => re.test(bare) || re.test(n));
}

/** Build a humanoid gait rig from bones (preferred) or named Object3D parts. */
export function collectGaitRig(root: THREE.Object3D): GaitRig {
  const bones: Partial<Record<LimbSlot, THREE.Object3D>> = {};
  const candidates: THREE.Object3D[] = [];

  root.traverse((o) => {
    if (!o.name) return;
    if ((o as THREE.Bone).isBone || o.type === 'Bone') candidates.push(o);
  });
  // Articulated mannequins: only nodes whose names look like limbs/spine.
  if (candidates.length < 4) {
    const limbHint = /upleg|thigh|calf|shin|foot|arm|forearm|spine|chest|hip|leg|shoulder|knee|ankle/i;
    root.traverse((o) => {
      if (!o.name || o === root) return;
      if (limbHint.test(o.name)) candidates.push(o);
    });
  }

  for (const slot of Object.keys(SLOT_PATTERNS) as LimbSlot[]) {
    if (bones[slot]) continue;
    const hit = candidates.find((c) => matchSlot(c.name, slot));
    if (hit) bones[slot] = hit;
  }

  const rest = new Map<THREE.Object3D, THREE.Quaternion>();
  for (const b of Object.values(bones)) {
    if (!b || rest.has(b)) continue;
    rest.set(b, b.quaternion.clone());
  }

  const ready = Boolean(bones.hipL && bones.hipR);
  return { bones, rest, ready };
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'XYZ');

function applySwing(
  bone: THREE.Object3D | undefined,
  rest: Map<THREE.Object3D, THREE.Quaternion>,
  pitchX: number,
  yawY = 0,
  rollZ = 0,
): void {
  if (!bone) return;
  const r = rest.get(bone);
  if (!r) return;
  _e.set(pitchX, yawY, rollZ);
  _q.setFromEuler(_e);
  bone.quaternion.copy(r).multiply(_q);
}

/**
 * Proper bipedal walk (mannequin gait) — opposite legs/arms, knee flex on swing,
 * light torso counter-rotate. No whole-body waddle.
 *
 * @param phase radians, advances while moving
 * @param weight 0 idle → 1 full stride
 */
export function applyProceduralWalkGait(
  rig: GaitRig,
  phase: number,
  weight: number,
): void {
  const w = THREE.MathUtils.clamp(weight, 0, 1);
  if (w < 0.001) {
    for (const [bone, q] of rig.rest) bone.quaternion.copy(q);
    return;
  }

  const s = Math.sin(phase);
  const c = Math.cos(phase);
  // Opposite limbs
  const leftLeg = s;
  const rightLeg = -s;

  // Stride amplitudes (radians) — long step like the reference mannequin.
  const hipAmp = 0.55 * w;
  const kneeAmp = 0.85 * w;
  const footAmp = 0.35 * w;
  const armAmp = 0.45 * w;
  const foreAmp = 0.35 * w;
  const spineTwist = 0.08 * w;
  const spineLean = 0.04 * w;

  // Hips: pitch forward/back
  applySwing(rig.bones.hipL, rig.rest, leftLeg * hipAmp);
  applySwing(rig.bones.hipR, rig.rest, rightLeg * hipAmp);

  // Knees: bend on the swing/pass-through (when thigh is moving forward through mid).
  // max(0, -cos) peaks when that leg is swinging through.
  const kneeL = Math.max(0, -c) * kneeAmp;
  const kneeR = Math.max(0, c) * kneeAmp;
  applySwing(rig.bones.kneeL, rig.rest, kneeL);
  applySwing(rig.bones.kneeR, rig.rest, kneeR);

  // Ankles: toe-off on trailing leg
  applySwing(rig.bones.footL, rig.rest, Math.max(0, -leftLeg) * footAmp);
  applySwing(rig.bones.footR, rig.rest, Math.max(0, -rightLeg) * footAmp);

  // Arms opposite to legs
  applySwing(rig.bones.armL, rig.rest, -leftLeg * armAmp);
  applySwing(rig.bones.armR, rig.rest, -rightLeg * armAmp);
  applySwing(rig.bones.foreL, rig.rest, Math.max(0, leftLeg) * foreAmp);
  applySwing(rig.bones.foreR, rig.rest, Math.max(0, rightLeg) * foreAmp);

  // Torso counter-rotation + slight forward lean
  applySwing(rig.bones.spine, rig.rest, spineLean, s * spineTwist);
  applySwing(rig.bones.chest, rig.rest, spineLean * 0.5, -s * spineTwist * 0.6);
}

/** Cycle rate (Hz) scaled by move intensity. */
export function walkPhaseStep(dt: number, moving: boolean, speedNorm: number): number {
  if (!moving) return 0;
  const hz = THREE.MathUtils.clamp(1.55 + speedNorm * 0.9, 1.4, 2.4);
  return dt * hz * Math.PI * 2;
}
