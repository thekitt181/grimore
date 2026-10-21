import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { useFirstPersonStore } from '@/systems/map3d/firstPersonStore';
import { firstPersonMotion } from '@/systems/map3d/firstPersonMotion';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import { getWalkPose, isWalkPoseFresh } from '@/systems/scene/token/walkPoseBus';
import { fpGlobal } from './fpGlobals';
import {
  lockModelHorizontalToFeet,
  pinRootMotionHorizontal,
  stripClipHipTranslation,
} from './tokenFootPlant';
import {
  applyProceduralWalkGait,
  collectGaitRig,
  walkPhaseStep,
} from './proceduralWalkGait';

const MOVE_START = 6;
const MOVE_STOP = 3;
const HOLD = 0.28;

function pickClip(
  clips: THREE.AnimationClip[],
  patterns: RegExp[],
): THREE.AnimationClip | undefined {
  for (const re of patterns) {
    const hit = clips.find((c) => re.test(c.name.toLowerCase()));
    if (hit) return hit;
  }
  return undefined;
}

function pickIdleClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | undefined {
  return pickClip(clips, [/idle/, /stand/, /breath/, /wait/, /rest/, /neutral/, /tpose/, /a_pose/]);
}

/** Prefer named walk; else longest; else the only clip (Sketchfab single-anim GLBs). */
function pickWalkClip(clips: THREE.AnimationClip[]): THREE.AnimationClip | undefined {
  if (clips.length === 0) return undefined;
  const idle = pickIdleClip(clips);
  const locomotion = idle ? clips.filter((c) => c !== idle) : clips;
  if (locomotion.length === 0) return undefined;
  const named = pickClip(locomotion, [
    /walk_unarmed_forward/,
    /unarmed.?walk/,
    /walking/,
    /walk/,
    /running/,
    /run/,
    /jog/,
    /locomotion/,
    /cycle/,
    /baselayer/,
  ]);
  if (named) return named;
  if (locomotion.length === 1) return locomotion[0];
  return [...locomotion].sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))[0];
}

function findFeetGroup(from: THREE.Object3D): THREE.Object3D | null {
  let p: THREE.Object3D | null = from;
  while (p) {
    if (typeof p.name === 'string' && p.name.startsWith('fp-feet-')) return p;
    p = p.parent;
  }
  return null;
}

function keysMoving(): boolean {
  const k = firstPersonMotion.held;
  return k.has('w') || k.has('a') || k.has('s') || k.has('d')
    || k.has('arrowup') || k.has('arrowdown') || k.has('arrowleft') || k.has('arrowright');
}

/**
 * Drive token walk with a dedicated AnimationMixer (not drei useAnimations),
 * so Sketchfab clip names with `|` still bind and play.
 */
export function useTokenGroundedLocomotion(
  root: THREE.Object3D | null,
  animations: THREE.AnimationClip[],
  enabled: boolean,
  itemId?: string,
) {
  const grounded = useMemo(() => {
    if (!enabled || !root || animations.length === 0) return [] as THREE.AnimationClip[];
    return stripClipHipTranslation(animations, root);
  }, [enabled, root, animations]);

  const idleClip = useMemo(() => pickIdleClip(grounded), [grounded]);
  const walkClip = useMemo(() => pickWalkClip(grounded), [grounded]);
  const gaitRig = useMemo(() => {
    if (!enabled || !root || walkClip) return null;
    const rig = collectGaitRig(root);
    return rig.ready ? rig : null;
  }, [enabled, root, walkClip]);

  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const walkActionRef = useRef<THREE.AnimationAction | null>(null);
  const idleActionRef = useRef<THREE.AnimationAction | null>(null);
  const prevRef = useRef<{ x: number; z: number; t: number } | null>(null);
  const movingRef = useRef(false);
  const holdUntil = useRef(0);
  const modeRef = useRef<'idle' | 'walk'>('idle');
  const gaitPhase = useRef(0);
  const gaitWeight = useRef(0);

  useEffect(() => {
    if (!enabled || !root || (!walkClip && !idleClip)) {
      mixerRef.current = null;
      walkActionRef.current = null;
      idleActionRef.current = null;
      return;
    }

    const mixer = new THREE.AnimationMixer(root);
    const walkAction = walkClip ? mixer.clipAction(walkClip) : null;
    const idleAction = idleClip ? mixer.clipAction(idleClip) : null;
    if (walkAction) {
      walkAction.setLoop(THREE.LoopRepeat, Infinity);
      walkAction.clampWhenFinished = false;
      walkAction.enabled = true;
      walkAction.paused = true;
      walkAction.time = 0;
      walkAction.setEffectiveWeight(0);
      walkAction.play();
    }
    if (idleAction) {
      idleAction.setLoop(THREE.LoopRepeat, Infinity);
      idleAction.clampWhenFinished = false;
      idleAction.enabled = true;
      idleAction.setEffectiveWeight(1);
      idleAction.play();
    }

    mixerRef.current = mixer;
    walkActionRef.current = walkAction;
    idleActionRef.current = idleAction;
    modeRef.current = idleAction ? 'idle' : 'walk';

    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(root);
      if (mixerRef.current === mixer) mixerRef.current = null;
      walkActionRef.current = null;
      idleActionRef.current = null;
    };
  }, [enabled, root, walkClip, idleClip]);

  useFrame((state, dt) => {
    if (!enabled || !root) return;

    const fp = useFirstPersonStore.getState();
    const localDriver = Boolean(itemId && fp.enabled && fp.tokenId === itemId);
    const remoteWalk = Boolean(itemId && !localDriver && isWalkPoseFresh(itemId));

    if (!itemId) {
      mixerRef.current?.update(dt);
      pinRootMotionHorizontal(root);
      return;
    }

    const item = useItemStore.getState().items[itemId];
    if (!item || item.type !== 'token') {
      mixerRef.current?.update(dt);
      pinRootMotionHorizontal(root);
      return;
    }

    const t = state.clock.elapsedTime;
    let speed = 0;
    let moving = movingRef.current;

    if (localDriver) {
      speed = Math.hypot(firstPersonMotion.velX, firstPersonMotion.velY);
      moving = keysMoving() || speed > 0.5 || fpGlobal.walkStreaming;
      if (moving) holdUntil.current = t + HOLD;
    } else if (remoteWalk) {
      const pose = getWalkPose(itemId);
      const prev = prevRef.current;
      if (pose && prev) {
        const dClock = Math.max(1e-3, t - prev.t);
        speed = Math.hypot(pose.x - prev.x, pose.y - prev.z) / dClock;
      }
      if (pose) prevRef.current = { x: pose.x, z: pose.y, t };
      moving = true;
      holdUntil.current = t + HOLD;
    } else {
      const live = useLiveTransformStore.getState().byId[itemId];
      const b = resolveItemBounds(item, live);
      const prev = prevRef.current;
      if (prev) {
        const dClock = Math.max(1e-3, t - prev.t);
        speed = Math.hypot(b.cx - prev.x, b.cz - prev.z) / dClock;
      }
      prevRef.current = { x: b.cx, z: b.cz, t };
      if (speed >= MOVE_START) {
        moving = true;
        holdUntil.current = t + HOLD;
      } else if (speed <= MOVE_STOP && t >= holdUntil.current) {
        moving = false;
      }
    }

    if (!localDriver && !remoteWalk && t >= holdUntil.current && speed <= MOVE_STOP) {
      moving = false;
    }
    movingRef.current = moving;

    // Procedural gait only when the GLB has no clips.
    if (!walkClip) {
      if (gaitRig) {
        const speedNorm = THREE.MathUtils.clamp(speed / 120, 0, 1.5);
        gaitPhase.current += walkPhaseStep(dt, moving, speedNorm);
        const targetW = moving ? 1 : 0;
        gaitWeight.current = THREE.MathUtils.damp(gaitWeight.current, targetW, moving ? 8 : 6, dt);
        applyProceduralWalkGait(gaitRig, gaitPhase.current, gaitWeight.current);
      }
      return;
    }

    const walkAction = walkActionRef.current;
    const idleAction = idleActionRef.current;
    const mixer = mixerRef.current;
    if (!mixer || (!walkAction && !idleAction)) return;

    const want: 'idle' | 'walk' = moving && walkAction ? 'walk' : 'idle';
    if (want !== modeRef.current) {
      if (want === 'walk' && walkAction) {
        walkAction.reset();
        walkAction.setLoop(THREE.LoopRepeat, Infinity);
        walkAction.paused = false;
        walkAction.enabled = true;
        walkAction.setEffectiveWeight(1);
        walkAction.play();
        idleAction?.setEffectiveWeight(0);
      } else if (idleAction) {
        idleAction.setEffectiveWeight(1);
        if (!idleAction.isRunning()) idleAction.play();
        walkAction?.setEffectiveWeight(0);
        if (walkAction) walkAction.paused = true;
      } else if (walkAction) {
        walkAction.paused = true;
        walkAction.time = 0;
        walkAction.setEffectiveWeight(1);
      }
      modeRef.current = want;
    }

    if (want === 'walk' && walkAction) {
      walkAction.paused = false;
      walkAction.setEffectiveTimeScale(
        THREE.MathUtils.clamp(0.95 + Math.min(speed, 200) * 0.004, 0.9, 1.75),
      );
    }

    // Mixer first, then pin root XZ so limb translation from the clip survives.
    mixer.update(dt);
    pinRootMotionHorizontal(root);

    const feet = findFeetGroup(root);
    if (feet) {
      const walkPose = getWalkPose(itemId);
      if (walkPose && (remoteWalk || localDriver)) {
        feet.position.x = walkPose.x + item.width / 2;
        feet.position.z = walkPose.y + item.height / 2;
        if (walkPose.rotation != null) {
          feet.rotation.y = -((walkPose.rotation * Math.PI) / 180);
        }
      }
      lockModelHorizontalToFeet(root, feet);
      feet.updateMatrixWorld(true);
    }
  });
}
