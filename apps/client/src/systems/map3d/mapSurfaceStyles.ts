/**
 * Selectable wall / blank-floor looks for 3D + FP.
 * Colors align with dungeon generator motifs in paintDungeonImage.ts.
 */

export type MapSurfaceStyleId =
  | 'default'
  | 'map'
  | 'mixed'
  | 'crypt'
  | 'temple'
  | 'fortress'
  | 'mine'
  | 'ruin'
  | 'clay';

export interface MapSurfaceStyle {
  id: MapSurfaceStyleId;
  label: string;
  wall: string;
  wallDark: string;
  floor: string;
  floorRough: string;
  wallRoughness: number;
  floorRoughness: number;
}

export const MAP_SURFACE_STYLES: Record<MapSurfaceStyleId, MapSurfaceStyle> = {
  /** Flat / previous look — floor uses map image when present. */
  default: {
    id: 'default',
    label: 'Flat color',
    wall: '#5c4033',
    wallDark: '#3d2918',
    floor: '#252532',
    floorRough: '#1c1c28',
    wallRoughness: 0.85,
    floorRoughness: 0.92,
  },
  /** Floor only: keep the map’s background image in 3D/FP. */
  map: {
    id: 'map',
    label: 'Map image',
    wall: '#5c4033',
    wallDark: '#3d2918',
    floor: '#252532',
    floorRough: '#1c1c28',
    wallRoughness: 0.85,
    floorRoughness: 0.92,
  },
  mixed: {
    id: 'mixed',
    label: 'Mixed stone',
    wall: '#5c554c',
    wallDark: '#2a2620',
    floor: '#b0a090',
    floorRough: '#8a7a68',
    wallRoughness: 0.86,
    floorRoughness: 0.88,
  },
  crypt: {
    id: 'crypt',
    label: 'Crypt',
    wall: '#4e5854',
    wallDark: '#222826',
    floor: '#929a92',
    floorRough: '#727a74',
    wallRoughness: 0.88,
    floorRoughness: 0.9,
  },
  temple: {
    id: 'temple',
    label: 'Temple',
    wall: '#6e6452',
    wallDark: '#353024',
    floor: '#c4b8a0',
    floorRough: '#a0947c',
    wallRoughness: 0.8,
    floorRoughness: 0.86,
  },
  fortress: {
    id: 'fortress',
    label: 'Fortress',
    wall: '#585856',
    wallDark: '#28282a',
    floor: '#9a9a96',
    floorRough: '#7a7a76',
    wallRoughness: 0.84,
    floorRoughness: 0.88,
  },
  mine: {
    id: 'mine',
    label: 'Mine',
    wall: '#5a544c',
    wallDark: '#2c2824',
    floor: '#948c80',
    floorRough: '#787068',
    wallRoughness: 0.9,
    floorRoughness: 0.92,
  },
  ruin: {
    id: 'ruin',
    label: 'Ruin',
    wall: '#625040',
    wallDark: '#322820',
    floor: '#b09074',
    floorRough: '#907058',
    wallRoughness: 0.88,
    floorRoughness: 0.9,
  },
  clay: {
    id: 'clay',
    label: 'Clay',
    wall: '#8c8880',
    wallDark: '#6e6b65',
    floor: '#7a7770',
    floorRough: '#5c5954',
    wallRoughness: 0.92,
    floorRoughness: 0.94,
  },
};

export const MAP_SURFACE_STYLE_OPTIONS: MapSurfaceStyle[] = Object.values(MAP_SURFACE_STYLES);

export function resolveMapSurfaceStyle(id: string | undefined | null): MapSurfaceStyle {
  if (id && id in MAP_SURFACE_STYLES) {
    return MAP_SURFACE_STYLES[id as MapSurfaceStyleId];
  }
  return MAP_SURFACE_STYLES.default;
}

export function isMapSurfaceStyleId(id: unknown): id is MapSurfaceStyleId {
  return typeof id === 'string' && id in MAP_SURFACE_STYLES;
}
