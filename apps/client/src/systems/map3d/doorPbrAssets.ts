import type { DoorStyleId } from './doorSurfaceStyles';
import { pbrAssetForStyle } from './pbrSurfaceAssets';
import type { MapSurfaceStyleId } from './mapSurfaceStyles';

export type DoorMaterialFamily = 'wall' | 'wood' | 'metal' | 'barred' | 'arcane';

export type DoorTextureSpec = {
  family: DoorMaterialFamily;
  /** Poly Haven slug; omitted when family is `wall`. */
  pbrSlug?: string;
  /** Vertical portcullis-style bars on the panel face. */
  barred?: boolean;
};

const DOOR_TEXTURE: Record<DoorStyleId, DoorTextureSpec> = {
  mixed: { family: 'wood', pbrSlug: 'brown_planks_03' },
  crypt: { family: 'wood', pbrSlug: 'dark_planks' },
  temple: { family: 'wood', pbrSlug: 'wood_planks' },
  fortress: { family: 'metal', pbrSlug: 'metal_plate_02' },
  mine: { family: 'wood', pbrSlug: 'brown_planks_03' },
  ruin: { family: 'wood', pbrSlug: 'wood_planks' },
  clay: { family: 'wood', pbrSlug: 'brown_planks_03' },
  oak: { family: 'wood', pbrSlug: 'brown_planks_03' },
  'wood-pine': { family: 'wood', pbrSlug: 'wood_planks' },
  'wood-walnut': { family: 'wood', pbrSlug: 'dark_planks' },
  'wood-rotten': { family: 'wood', pbrSlug: 'wood_planks' },
  iron: { family: 'metal', pbrSlug: 'metal_plate_02' },
  'metal-steel': { family: 'metal', pbrSlug: 'metal_plate' },
  'metal-rust': { family: 'metal', pbrSlug: 'rusty_metal' },
  bronze: { family: 'metal', pbrSlug: 'metal_plate_02' },
  obsidian: { family: 'arcane', pbrSlug: 'dark_planks' },
  sandstone: { family: 'wall', pbrSlug: 'sandstone_blocks_04' },
  elven: { family: 'wood', pbrSlug: 'wood_planks' },
  dwarven: { family: 'metal', pbrSlug: 'metal_plate_02' },
  bone: { family: 'arcane', pbrSlug: 'wood_planks' },
  fel: { family: 'arcane', pbrSlug: 'rusty_metal' },
  'barred-iron': { family: 'barred', pbrSlug: 'metal_plate_02', barred: true },
  'barred-rust': { family: 'barred', pbrSlug: 'rusty_metal', barred: true },
  'barred-oak': { family: 'barred', pbrSlug: 'brown_planks_03', barred: true },
  'barred-cell': { family: 'barred', pbrSlug: 'metal_plate', barred: true },
};

export function doorTextureSpec(doorStyleId: string | undefined | null): DoorTextureSpec {
  if (doorStyleId && doorStyleId in DOOR_TEXTURE) {
    return DOOR_TEXTURE[doorStyleId as DoorStyleId];
  }
  return { family: 'wall' };
}

/** PBR asset id for a door theme — wall-linked styles follow the map wall art. */
export function doorPbrAssetId(
  doorStyleId: string | undefined | null,
  wallStyleId: string | undefined | null,
): string | null {
  const spec = doorTextureSpec(doorStyleId);
  if (spec.pbrSlug) return spec.pbrSlug;
  if (spec.family === 'wall') {
    return pbrAssetForStyle((wallStyleId ?? 'mixed') as MapSurfaceStyleId, 'wall');
  }
  return null;
}

export function doorStyleIsBarred(doorStyleId: string | undefined | null): boolean {
  return Boolean(doorTextureSpec(doorStyleId).barred);
}

export function allDoorPbrSlugs(): string[] {
  const slugs = new Set<string>();
  for (const spec of Object.values(DOOR_TEXTURE)) {
    if (spec.pbrSlug) slugs.add(spec.pbrSlug);
  }
  return [...slugs];
}
