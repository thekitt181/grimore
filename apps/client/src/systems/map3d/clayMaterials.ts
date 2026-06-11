/** Unified matte palette for scanned 3D clay-style renders. */
export const CLAY = {
  floor: '#7a7770',
  wall: '#8c8880',
  wallDark: '#6e6b65',
  prop: '#949088',
  propLight: '#a8a49c',
  propDark: '#5c5954',
  water: '#707880',
  pit: '#141414',
  pitRim: '#75726a',
} as const;

export function clayMaterialProps(tone: keyof typeof CLAY = 'prop') {
  return {
    color: CLAY[tone],
    roughness: 0.92,
    metalness: 0.02,
  };
}
