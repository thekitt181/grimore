/**
 * High-quality textured GLB props (KayKit Dungeon Remastered, CC0).
 * Served from /props3d — 2D editor still uses PNG sprites.
 *
 * Only map propIds to GLBs that actually match. Stand-ins (fountain→pillar,
 * trap→sword) made props look broken — those use procedural meshes instead.
 */

import { canonicalPropId } from '@/systems/map/props/propArt';
import { ALSTRA_PROP_MODELS } from '@/systems/map/props/alstraPropCatalog';
import { KAYKIT_PROP_MODELS } from '@/systems/map/props/kaykitPropCatalog';
import { SPAJX_PROP_MODELS } from '@/systems/map/props/spajxPropCatalog';

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
  /** Single-mesh chests: synthesize a lid hinge at runtime. */
  hingeLid?: boolean;
};

const P = '/props3d';

/** Catalog propId → KayKit GLB. Unlisted ids fall back to procedural meshes. */
export const PROP_MODEL_3D: Record<string, PropModelSpec> = {
  ...KAYKIT_PROP_MODELS,
  ...ALSTRA_PROP_MODELS,
  ...SPAJX_PROP_MODELS,
  crate: { url: `${P}/crate.glb`, sizeBias: 0.95 },
  barrel: { url: `${P}/kaykit/barrel_small.glb`, sizeBias: 0.95 },
  keg: { url: `${P}/kaykit/keg.glb`, sizeBias: 0.9 },
  coins: { url: `${P}/coins.glb`, sizeBias: 0.72 },
  key: { url: `${P}/kaykit/key.glb`, sizeBias: 0.55 },
  column: { url: `${P}/kaykit/column.glb`, sizeBias: 1.35 },
  pedestal: { url: `${P}/kaykit/pillar.glb`, sizeBias: 0.85 },
  boulder: { url: `${P}/kaykit/rubble_large.glb`, sizeBias: 1.05 },
  'stairs-up': { url: `${P}/stairs.glb`, sizeBias: 1.2 },
  'stairs-down': { url: `${P}/stairs.glb`, sizeBias: 1.2 },
  potion: { url: `${P}/kaykit/bottle_A_green.glb`, sizeBias: 0.55 },
  candle: { url: `${P}/kaykit/candle.glb`, sizeBias: 0.55, light: 'torch' },
  torch: { url: `${P}/kaykit/torch_lit.glb`, sizeBias: 1.2, light: 'torch' },
  'weapon-rack': { url: `${P}/kaykit/sword_shield.glb`, sizeBias: 1.05 },
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
    if (spec.url.includes('/spajx/')) continue;
    urls.add(spec.url);
    if (spec.openUrl) urls.add(spec.openUrl);
  }
  return [...urls];
}
