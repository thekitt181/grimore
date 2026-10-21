import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useLiveTransformStore } from '@/systems/scene/store/liveTransformStore';
import { resolveItemBounds } from '@/systems/map3d/sceneItemBounds';
import type { TokenItem } from '@/systems/scene/types';
import { plantTokenFeet } from './tokenFootPlant';
import {
  createProceduralRigState,
  measureMoveSpeed,
  resolveSmartRigMode,
  tickProceduralRig,
  tokenLooksDead,
  type ClipRole,
  type ProceduralRigState,
} from './tokenSmartRig';

const MOVE_START_SPEED = 6;
const MOVE_STOP_SPEED = 3;
const RUN_SPEED = 110;
const MOVE_HOLD_SEC = 0.28;
const FADE = 0.18;

type Locomote = 'idle' | 'walk' | 'run' | 'procWalk' | 'attack' | 'hit' | 'death' | 'cast' | 'emote';

/**
 * Token smart rig (tokens only — never maps):
 * - idle / walk / run from GLB clips; procedural legs if none
 * - plant feet after mixer (no mesh-bob, no clip mutation)
 */
export function useTokenSmartRig(
  root: THREE.Object3D | null,
  animations: THREE.AnimationClip[],
  enabled: boolean,
  itemId?: string,
) {
  const modeInfo = useMemo(() => {
    if (!enabled || !root) {
      return {
        mode: 'none' as const,
        bones: {},
        catalog: {},
        mixerClips: [] as THREE.AnimationClip[],
      };
    }
    return resolveSmartRigMode(root, animations);
  }, [enabled, root, animations]);

  const catalog = modeInfo.catalog;
  const mixerClips = modeInfo.mixerClips;

  const { actions } = useAnimations(
    enabled && mixerClips.length > 0 ? mixerClips : [],
    root ?? undefined,
  );

  const proceduralRef = useRef<ProceduralRigState | null>(null);
  const prevPosRef = useRef<{ x: number; z: number; t: number } | null>(null);
  const movingRef = useRef(false);
  const holdUntilRef = useRef(0);
  const locomoteRef = useRef<Locomote>('idle');
  const prevHpRef = useRef<number | null>(null);
  const oneShotUntilRef = useRef(0);

  const actionFor = (role: ClipRole): THREE.AnimationAction | null => {
    const clip = catalog[role];
    if (!clip) return null;
    return actions[clip.name] ?? null;
  };

  const fadeToLoop = (role: 'idle' | 'walk' | 'run', speed = 0) => {
    const next = actionFor(role);
    const idleClip = catalog.idle;
    const walkClip = catalog.walk;
    const runClip = catalog.run;
    const sameAsIdle =
      (role === 'walk' && walkClip && idleClip && walkClip === idleClip)
      || (role === 'run' && runClip && idleClip && runClip === idleClip);

    if (sameAsIdle && next) {
      if (!next.isRunning()) {
        next.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE).play();
      }
      next.setEffectiveTimeScale(THREE.MathUtils.clamp(1.15 + speed * 0.005, 1.15, 2));
      locomoteRef.current = role;
      return;
    }

    if (locomoteRef.current === role && next?.isRunning()) {
      if (role === 'walk' || role === 'run') {
        next.setEffectiveTimeScale(THREE.MathUtils.clamp(0.9 + speed * 0.005, 0.9, 1.85));
      }
      return;
    }

    for (const r of ['idle', 'walk', 'run', 'emote'] as const) {
      if (r === role) continue;
      const other = catalog[r];
      const incoming = catalog[role];
      if (other && incoming && other === incoming) continue;
      actionFor(r)?.fadeOut(FADE);
    }
    if (next) {
      next.reset().setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
      next.setEffectiveTimeScale(
        role === 'idle' ? 1 : THREE.MathUtils.clamp(0.9 + speed * 0.005, 0.9, 1.85),
      );
      next.fadeIn(FADE).play();
      locomoteRef.current = role;
    }
  };

  const playOneShot = (role: 'attack' | 'hit' | 'death' | 'cast' | 'emote', now: number) => {
    const next = actionFor(role);
    if (!next) return false;
    for (const r of ['idle', 'walk', 'run', 'attack', 'hit', 'cast', 'emote'] as const) {
      if (r === role) continue;
      actionFor(r)?.fadeOut(0.1);
    }
    next.reset();
    next.setLoop(THREE.LoopOnce, 1);
    next.clampWhenFinished = true;
    next.fadeIn(0.08).play();
    locomoteRef.current = role;
    oneShotUntilRef.current = now + Math.max(0.35, next.getClip().duration * 0.95);
    return true;
  };

  useEffect(() => {
    if (!enabled || !root) {
      proceduralRef.current = null;
      return;
    }

    const boneCount = Object.keys(modeInfo.bones).length;
    proceduralRef.current = boneCount >= 3 ? createProceduralRigState(modeInfo.bones) : null;

    if (mixerClips.length > 0) {
      const idle = catalog.idle ? actions[catalog.idle.name] : null;
      if (idle) {
        idle.reset().setLoop(THREE.LoopRepeat, Infinity).fadeIn(FADE).play();
        locomoteRef.current = 'idle';
      }
    }

    return () => {
      for (const key of Object.keys(actions)) {
        actions[key]?.fadeOut(0.1);
      }
      proceduralRef.current = null;
    };
  }, [enabled, root, modeInfo, mixerClips, catalog, actions]);

  useFrame((state) => {
    if (!enabled || !root) return;

    const finish = () => {
      plantTokenFeet(root);
    };

    if (!itemId) {
      finish();
      return;
    }

    const item = useItemStore.getState().items[itemId];
    if (!item || item.type !== 'token') {
      finish();
      return;
    }
    const token = item as TokenItem;

    const live = useLiveTransformStore.getState().byId[itemId];
    const b = resolveItemBounds(token, live);
    const t = state.clock.elapsedTime;
    const { speed, next } = measureMoveSpeed(prevPosRef.current, b.cx, b.cz, t);
    prevPosRef.current = next;

    let moving = movingRef.current;
    if (speed >= MOVE_START_SPEED) {
      moving = true;
      holdUntilRef.current = t + MOVE_HOLD_SEC;
    } else if (speed <= MOVE_STOP_SPEED && t >= holdUntilRef.current) {
      moving = false;
    }
    movingRef.current = moving;

    const hp = token.hp ?? 0;
    if (prevHpRef.current == null) prevHpRef.current = hp;
    const hpDropped = hp < prevHpRef.current;
    const dead = tokenLooksDead(token);
    prevHpRef.current = hp;

    const hasClips = mixerClips.length > 0;

    if (hasClips) {
      if (dead && locomoteRef.current !== 'death') {
        playOneShot('death', t);
      } else if (locomoteRef.current !== 'death') {
        const inOneShot =
          t < oneShotUntilRef.current
          && (locomoteRef.current === 'hit'
            || locomoteRef.current === 'attack'
            || locomoteRef.current === 'cast');

        if (!inOneShot) {
          if (hpDropped && hp > 0) {
            playOneShot('hit', t);
          } else if (moving) {
            if (speed >= RUN_SPEED && catalog.run) {
              fadeToLoop('run', speed);
            } else if (catalog.walk || catalog.run) {
              fadeToLoop(catalog.walk ? 'walk' : 'run', speed);
            } else if (proceduralRef.current) {
              actionFor('idle')?.fadeOut(FADE);
              locomoteRef.current = 'procWalk';
              tickProceduralRig(proceduralRef.current, t, true, speed);
            }
          } else if (catalog.idle) {
            fadeToLoop('idle');
          } else if (proceduralRef.current) {
            locomoteRef.current = 'idle';
            tickProceduralRig(proceduralRef.current, t, false, 0);
          }
        }
      }
    } else if (proceduralRef.current) {
      tickProceduralRig(proceduralRef.current, t, moving && !dead, dead ? 0 : speed);
    }

    finish();
  }, 1);
}
