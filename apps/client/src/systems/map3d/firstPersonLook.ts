import { fpGlobal, type FpLookState } from './fpGlobals';

/** Always resolve through globalThis — never capture look at module load. */
export const firstPersonLook: FpLookState = new Proxy({} as FpLookState, {
  get(_t, prop, _r) {
    return Reflect.get(fpGlobal.look, prop, fpGlobal.look);
  },
  set(_t, prop, value) {
    return Reflect.set(fpGlobal.look, prop, value);
  },
  has(_t, prop) {
    return Reflect.has(fpGlobal.look, prop);
  },
});

const PITCH_MIN = -0.85;
const PITCH_MAX = 0.95;

export function resetFirstPersonLook(yawDeg = 0): void {
  firstPersonLook.yaw = ((yawDeg % 360) + 360) % 360;
  firstPersonLook.pitch = 0;
  fpGlobal.lookPending.yawDeg = 0;
  fpGlobal.lookPending.pitchRad = 0;
}

export function adjustFirstPersonLook(deltaYawDeg: number, deltaPitchRad: number): void {
  firstPersonLook.yaw = ((firstPersonLook.yaw + deltaYawDeg) % 360 + 360) % 360;
  firstPersonLook.pitch = Math.max(
    PITCH_MIN,
    Math.min(PITCH_MAX, firstPersonLook.pitch + deltaPitchRad),
  );
}

/** ~0.22°/px — matches pointer-lock feel on 1080p. */
const LOOK_RAD_PER_PX = 0.00385;
/** Only clip pathological spikes (alt-tab / lock acquire) — not normal flicks. */
const LOOK_PX_SPIKE = 720;

function applyLookDeltaPx(deltaPxX: number, deltaPxY: number): void {
  if (!Number.isFinite(deltaPxX) || !Number.isFinite(deltaPxY)) return;
  // Drop one-frame teleport spikes; keep full range for high-poll mice.
  if (Math.abs(deltaPxX) > LOOK_PX_SPIKE || Math.abs(deltaPxY) > LOOK_PX_SPIKE) return;
  if (deltaPxX === 0 && deltaPxY === 0) return;
  const yawDeg = deltaPxX * LOOK_RAD_PER_PX * (180 / Math.PI);
  const pitchRad = -deltaPxY * LOOK_RAD_PER_PX;
  adjustFirstPersonLook(yawDeg, pitchRad);
}

/** Apply look immediately (zero extra frame of mouse lag). */
export function accumulateFirstPersonLook(deltaPxX: number, deltaPxY: number): void {
  applyLookDeltaPx(deltaPxX, deltaPxY);
}

/** Legacy coalesce path — drains any stale pending deltas. */
export function consumeFirstPersonLookPending(): boolean {
  const p = fpGlobal.lookPending;
  if (Math.abs(p.yawDeg) < 1e-6 && Math.abs(p.pitchRad) < 1e-6) return false;
  adjustFirstPersonLook(p.yawDeg, p.pitchRad);
  p.yawDeg = 0;
  p.pitchRad = 0;
  return true;
}
