import type { MapSurfaceStyleId } from './mapSurfaceStyles';

/**
 * CC0 Poly Haven texture slugs — 2k JPG PBR (diffuse + nor_gl + rough + optional ao).
 * Slugs must match https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/{id}/{id}_diff_2k.jpg
 */
const WALL: Partial<Record<MapSurfaceStyleId, string>> = {
  mixed: 'brick_wall_02',
  crypt: 'stone_brick_wall_001',
  temple: 'sandstone_brick_wall_01',
  fortress: 'brick_wall_04',
  mine: 'rock_wall',
  ruin: 'rock_face',
  clay: 'clay_block_wall',
};

const FLOOR: Partial<Record<MapSurfaceStyleId, string>> = {
  mixed: 'cobblestone_floor_03',
  crypt: 'floor_tiles_06',
  temple: 'sandstone_blocks_04',
  fortress: 'brick_floor_02',
  mine: 'rocky_terrain_02',
  ruin: 'cobblestone_floor_03',
  clay: 'clay_plaster',
};

export function pbrAssetForStyle(
  styleId: MapSurfaceStyleId,
  kind: 'floor' | 'wall',
): string | null {
  if (styleId === 'default' || styleId === 'map') return null;
  const table = kind === 'wall' ? WALL : FLOOR;
  return table[styleId] ?? null;
}

export function polyHavenJpgUrl(assetId: string, map: 'diff' | 'nor_gl' | 'rough' | 'ao'): string {
  return `https://dl.polyhaven.org/file/ph-assets/Textures/jpg/2k/${assetId}/${assetId}_${map}_2k.jpg`;
}
