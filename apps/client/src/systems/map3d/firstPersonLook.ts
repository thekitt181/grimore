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
}

export function adjustFirstPersonLook(deltaYawDeg: number, deltaPitchRad: number): void {
  firstPersonLook.yaw = ((firstPersonLook.yaw + deltaYawDeg) % 360 + 360) % 360;
  firstPersonLook.pitch = Math.max(
    PITCH_MIN,
    Math.min(PITCH_MAX, firstPersonLook.pitch + deltaPitchRad),
  );
}
