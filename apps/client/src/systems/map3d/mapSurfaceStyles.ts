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
    wall: '#5a534b',
    wallDark: '#2c2823',
    floor: '#a89a84',
    floorRough: '#847662',
    wallRoughness: 0.88,
    floorRoughness: 0.9,
  },
  crypt: {
    id: 'crypt',
    label: 'Crypt',
    wall: '#4c5652',
    wallDark: '#232826',
    floor: '#8a928a',
    floorRough: '#6c746e',
    wallRoughness: 0.9,
    floorRoughness: 0.93,
  },
  temple: {
    id: 'temple',
    label: 'Temple',
    wall: '#6a604e',
    wallDark: '#332e24',
    floor: '#bcb096',
    floorRough: '#9a8c74',
    wallRoughness: 0.82,
    floorRoughness: 0.88,
  },
  fortress: {
    id: 'fortress',
    label: 'Fortress',
    wall: '#555554',
    wallDark: '#2a2a2c',
    floor: '#969692',
    floorRough: '#767672',
    wallRoughness: 0.86,
    floorRoughness: 0.9,
  },
  mine: {
    id: 'mine',
    label: 'Mine',
    wall: '#433e38',
    wallDark: '#221e1a',
    floor: '#766c60',
    floorRough: '#60564a',
    wallRoughness: 0.94,
    floorRoughness: 0.95,
  },
  ruin: {
    id: 'ruin',
    label: 'Ruin',
    wall: '#5c4a3a',
    wallDark: '#2e241c',
    floor: '#a4886c',
    floorRough: '#84684e',
    wallRoughness: 0.9,
    floorRoughness: 0.92,
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
