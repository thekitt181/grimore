import type { Item } from './types';

/** Fixed bands so maps never cover tokens or walls regardless of stored zIndex. */
const Z_MAP = 0;
const Z_DRAW = 1_000;
const Z_WALL = 2_000;
const Z_FOG = 2_500;
const Z_TOKEN = 3_000;

export function itemDisplayZIndex(item: Item): number {
  const z = item.zIndex ?? 0;
  switch (item.type) {
    case 'map':
      return Z_MAP + z;
    case 'token':
      return Z_TOKEN + z;
    case 'drawing':
    case 'text':
      return Z_DRAW + z;
    default:
      return Z_DRAW + z;
  }
}

export function wallDisplayZIndex(mapZ: number): number {
  return Z_WALL + (mapZ ?? 0);
}

export function fogDisplayZIndex(mapZ: number): number {
  return Z_FOG + (mapZ ?? 0);
}
