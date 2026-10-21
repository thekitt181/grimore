import type { ImageItem } from '@/systems/scene/types';
import type { PropPlay } from './propArt';

/** Smoothstep 0→1. */
export function smoothstep(u: number): number {
  const t = Math.min(1, Math.max(0, u));
  return t * t * (3 - 2 * t);
}

/** Interpolate toward open (1) or closed (0) using propAt. */
export function propPose(item: ImageItem, seconds: number): number {
  const target = (item.propState ?? 0) > 0 ? 1 : 0;
  const at = item.propAt ?? 0;
  if (!at) return target;
  const e = smoothstep((Date.now() - at) / (seconds * 1000));
  return target ? e : 1 - e;
}

/** Springy open for traps / nets. */
export function propSpringPose(item: ImageItem, seconds: number): number {
  const target = (item.propState ?? 0) > 0 ? 1 : 0;
  const at = item.propAt ?? 0;
  if (!at) return target;
  const u = Math.min(1, Math.max(0, (Date.now() - at) / (seconds * 1000)));
  if (!target) return 1 - smoothstep(u);
  const c1 = 1.4;
  const c3 = c1 + 1;
  return 1 + c3 * (u - 1) ** 3 + c1 * (u - 1) ** 2;
}

/** Seconds since a fire/shot trigger (99 if idle). */
export function propShotElapsed(item: ImageItem): number {
  const at = item.propAt ?? 0;
  if (!at || (item.propState ?? 0) <= 0) return 99;
  return (Date.now() - at) / 1000;
}

/** Duration (seconds) matching the 2D Pixi prop animations. */
export function propPlayDuration(play: PropPlay): number {
  switch (play) {
    case 'lift':
      return 0.5;
    case 'swing':
      return 0.35;
    case 'split':
      return 0.55;
    case 'rise':
      return 0.28;
    case 'snap':
      return 0.18;
    case 'press':
      return 0.16;
    case 'drop':
      return 0.42;
    case 'ignite':
      return 0.35;
    case 'swap':
      return 0.35;
    case 'flow':
      return 0.45;
    case 'spread':
      return 0.28;
    default:
      return 0.35;
  }
}
