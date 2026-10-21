/**
 * High-quality textured GLB props (KayKit Dungeon Remastered, CC0).
 * Served from /props3d — 2D editor still uses PNG sprites.
 *
 * Only map propIds to GLBs that actually match. Stand-ins (fountain→pillar,
 * trap→sword) made props look broken — those use procedural meshes instead.
 */

import { canonicalPropId } from '@/systems/map/props/propArt';

export type PropModelSpec = {
  /** Closed / default model */
  url: string;
  /** Optional open / alternate model */
  openUrl?: string;
  /**
   * Fit bias vs footprint max-axis.
   * Tall thin props (torch, column) often need a higher target so they read at scale.
   */
  sizeBias?: number;
  /** Attach a warm point light (torch / campfire / lit altar) */
  light?: 'torch' | 'campfire' | 'altar';
};

const P = '/props3d';

/** Catalog propId → KayKit GLB. Unlisted ids fall back to procedural meshes. */
export const PROP_MODEL_3D: Record<string, PropModelSpec> = {
  chest: { url: `${P}/chest.glb`, sizeBias: 0.92 },
  sarcophagus: { url: `${P}/chest_gold.glb`, sizeBias: 1.05 },
  crate: { url: `${P}/crate.glb`, sizeBias: 0.95 },
  barrel: { url: `${P}/barrel.glb`, sizeBias: 0.95 },
  keg: { url: `${P}/keg.glb`, sizeBias: 0.9 },
  coins: { url: `${P}/coins.glb`, sizeBias: 0.72 },
  key: { url: `${P}/key.glb`, sizeBias: 0.55 },
  column: { url: `${P}/column.glb`, sizeBias: 1.35 },
  pedestal: { url: `${P}/pillar.glb`, sizeBias: 0.85 },
  campfire: { url: `${P}/campfire.glb`, sizeBias: 0.9, light: 'campfire' },
  boulder: { url: `${P}/boulder.glb`, sizeBias: 1.05 },
  plate: { url: `${P}/plate.glb`, sizeBias: 0.95 },
  'stairs-up': { url: `${P}/stairs.glb`, sizeBias: 1.2 },
  'stairs-down': { url: `${P}/stairs.glb`, sizeBias: 1.2 },
  potion: { url: `${P}/potion.glb`, sizeBias: 0.55 },
  ring: { url: `${P}/ring.glb`, sizeBias: 0.45 },
  shop: { url: `${P}/table.glb`, sizeBias: 1.1 },
  book: { url: `${P}/shelf.glb`, sizeBias: 0.85 },
};

export function resolvePropModel3D(
  propId: string | undefined,
  open = false,
): (PropModelSpec & { resolvedUrl: string }) | null {
  if (!propId) return null;
  const key = canonicalPropId(propId);
  const spec = PROP_MODEL_3D[key];
  if (!spec) return null;
  const resolvedUrl = open && spec.openUrl ? spec.openUrl : spec.url;
  return { ...spec, resolvedUrl };
}

export function hasPropModel3D(propId: string | undefined): boolean {
  if (!propId) return false;
  return canonicalPropId(propId) in PROP_MODEL_3D;
}

/** Unique GLB URLs for preload. */
export function allPropModelUrls(): string[] {
  const urls = new Set<string>();
  for (const spec of Object.values(PROP_MODEL_3D)) {
    urls.add(spec.url);
    if (spec.openUrl) urls.add(spec.openUrl);
  }
  return [...urls];
}
