import { fpGlobal, type FpMotionState } from './fpGlobals';

/**
 * Always read/write through globalThis (Proxy) — never capture `fpGlobal.motion`
 * at module load (HMR / duplicate chunks split controls vs camera held-keys).
 */
export const firstPersonMotion: FpMotionState = new Proxy({} as FpMotionState, {
  get(_t, prop, _r) {
    return Reflect.get(fpGlobal.motion, prop, fpGlobal.motion);
  },
  set(_t, prop, value) {
    return Reflect.set(fpGlobal.motion, prop, value);
  },
  has(_t, prop) {
    return Reflect.has(fpGlobal.motion, prop);
  },
});

export function resetFirstPersonMotion(): void {
  const m = fpGlobal.motion;
  m.velX = 0;
  m.velY = 0;
  m.held.clear();
  m.eyeY = NaN;
  m.groundY = 0;
  m.accum = 0;
}

/** Fixed physics step (seconds) — shared by camera + pose interpolation. */
export const FP_SIM_STEP = 1 / 120;

/** Exponential approach — frame-rate independent. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * Math.max(0, dt)));
}

export function dampAngleDeg(current: number, target: number, lambda: number, dt: number): number {
  let delta = ((target - current + 180) % 360 + 360) % 360 - 180;
  return current + delta * (1 - Math.exp(-lambda * Math.max(0, dt)));
}
