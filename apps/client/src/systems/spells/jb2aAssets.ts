import {
  catalogEntryToJb2aAsset,
  findSpellEffectCatalogEntry,
} from './spellEffectsCatalog';

export interface Jb2aVariant {
  suffix: string;
  width: number;
  height: number;
  durationMs: number;
}

export interface Jb2aEffectAsset {
  basename: string;
  dpi: number;
  variants: Record<string, Jb2aVariant>;
  directed?: boolean;
}

export interface SpellJb2aMapping {
  cast?: Jb2aEffectAsset;
  /** Explosion / burst at destination (e.g. Fireball after travel beam). */
  impact?: Jb2aEffectAsset;
  zone?: Jb2aEffectAsset;
}

const STANDARD_BEAM_FT = [5, 15, 30, 45, 60, 90] as const;
const BEAM_SIZE_BY_FT: Record<number, [number, number]> = {
  5: [600, 400],
  15: [1000, 400],
  30: [1600, 400],
  45: [2200, 400],
  60: [2800, 400],
  90: [4000, 400],
};

function ftSuffix(ft: number): string {
  return `${String(ft).padStart(2, '0')}ft`;
}

function buildIndexedBeamVariants(
  dpi: number,
  durationMs: number,
  defaultShot = '01',
): Record<string, Jb2aVariant> {
  const variants: Record<string, Jb2aVariant> = {};
  for (const ft of STANDARD_BEAM_FT) {
    const [width, height] = BEAM_SIZE_BY_FT[ft] ?? [1600, 400];
    variants[String(ft * 40)] = {
      suffix: `${ftSuffix(ft)}_${defaultShot}_${width}x${height}`,
      width,
      height,
      durationMs,
    };
  }
  return variants;
}

function buildChainLightningVariants(dpi: number, durationMs: number): Record<string, Jb2aVariant> {
  const variants: Record<string, Jb2aVariant> = {};
  for (const ft of STANDARD_BEAM_FT) {
    if (ft === 45) continue;
    const [width, height] = BEAM_SIZE_BY_FT[ft] ?? [1600, 400];
    variants[String(ft * 40)] = {
      suffix: `${ftSuffix(ft)}_Primary_${width}x${height}`,
      width,
      height,
      durationMs,
    };
    variants[String(ft * 40 + 1)] = {
      suffix: `${ftSuffix(ft)}_Secondary_${width}x${height}`,
      width,
      height,
      durationMs,
    };
  }
  return variants;
}

function buildBeamVariants(
  dpi: number,
  durationMs: number,
  feet: readonly number[] = STANDARD_BEAM_FT,
): Record<string, Jb2aVariant> {
  const variants: Record<string, Jb2aVariant> = {};
  for (const ft of feet) {
    const [width, height] = BEAM_SIZE_BY_FT[ft] ?? [1600, 400];
    variants[String(ft * 40)] = {
      suffix: `${ftSuffix(ft)}_${width}x${height}`,
      width,
      height,
      durationMs,
    };
  }
  return variants;
}

const EXTRA_BEAM_VARIANTS: Record<string, Record<string, Jb2aVariant>> = {
  '3rd_Level/Fireball/FireballBeam_01_Orange': buildBeamVariants(200, 4040),
  'Cantrip/Fire_Bolt/FireBolt_01_Regular_Orange': buildBeamVariants(200, 1530),
  'Cantrip/Eldritch_Blast/EldritchBlast_01_Regular_Purple': buildBeamVariants(200, 4370),
  '1st_Level/Magic_Missile/MagicMissile_01_Regular_Purple': buildIndexedBeamVariants(200, 1870),
  '2nd_Level/Scorching_Ray/ScorchingRay_01_Regular_Orange': buildBeamVariants(200, 1800),
  '1st_Level/Witch_Bolt/WitchBolt_01_Regular_Blue': buildBeamVariants(200, 4000),
  '1st_Level/Guiding_Bolt/GuidingBolt_01_Regular_BlueYellow': buildBeamVariants(200, 5900),
  'Cantrip/Ray_Of_Frost/RayOfFrost_01_Regular_Blue': buildBeamVariants(200, 2530),
  '6th_Level/Disintegrate/Disintegrate_01_Regular_Green01': buildBeamVariants(200, 3030),
  '6th_Level/Chain_Lightning/ChainLightning_01_Regular_Blue': buildChainLightningVariants(200, 1700),
};

const FIREBALL_EXPLOSION: Jb2aEffectAsset = {
  basename: '3rd_Level/Fireball/FireballExplosion_01_Orange',
  dpi: 200,
  variants: { '800': { suffix: '800x800', width: 800, height: 800, durationMs: 4040 } },
};

const SPELL_IMPACT_ASSETS: Record<string, Jb2aEffectAsset> = {
  fireball: FIREBALL_EXPLOSION,
};

export function parseVariantFeet(suffix: string): number | null {
  const m = /^(\d+)ft/i.exec(suffix);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

export function withBeamVariants(asset: Jb2aEffectAsset): Jb2aEffectAsset {
  const extra = EXTRA_BEAM_VARIANTS[asset.basename];
  if (!extra) return asset;
  return { ...asset, variants: { ...extra, ...asset.variants } };
}

/** JB2A missiles / chain lightning use per-shot suffixes (30ft_02_, Secondary, etc.). */
export function applyJb2aShotIndex(variant: Jb2aVariant, shotIndex: number): Jb2aVariant {
  if (/\d{2}ft_\d{2}_/i.test(variant.suffix)) {
    // JB2A ships _01_ and _02_ per length — cycle so 3+ missiles still play.
    const shot = String((shotIndex % 2) + 1).padStart(2, '0');
    return {
      ...variant,
      suffix: variant.suffix.replace(/(\d{2}ft_)\d{2}(_)/i, `$1${shot}$2`),
    };
  }
  if (/_Primary_|_Secondary_/i.test(variant.suffix)) {
    const useSecondary = shotIndex % 2 === 1;
    if (useSecondary) {
      return {
        ...variant,
        suffix: variant.suffix
          .replace(/_Primary_/i, '_Secondary_')
          .replace(/_secondary_/i, '_Secondary_'),
      };
    }
    return {
      ...variant,
      suffix: variant.suffix
        .replace(/_Secondary_/i, '_Primary_')
        .replace(/_secondary_/i, '_Secondary_'),
    };
  }
  return variant;
}

export function pickBeamVariantForWorldSpan(
  asset: Jb2aEffectAsset,
  worldSpan: number,
  gridSize: number,
): Jb2aVariant {
  const enriched = withBeamVariants(asset);
  const actualFeet = (worldSpan / gridSize) * 5;
  let best: Jb2aVariant | null = null;
  let bestFt = Number.POSITIVE_INFINITY;

  for (const variant of Object.values(enriched.variants)) {
    if (/_Secondary_/i.test(variant.suffix)) continue;
    const ft = parseVariantFeet(variant.suffix);
    if (ft == null) continue;
    if (ft >= actualFeet && ft < bestFt) {
      bestFt = ft;
      best = variant;
    }
  }

  if (best) return best;

  let largest: Jb2aVariant | null = null;
  let maxFt = -1;
  for (const variant of Object.values(enriched.variants)) {
    const ft = parseVariantFeet(variant.suffix) ?? 0;
    if (ft > maxFt) {
      maxFt = ft;
      largest = variant;
    }
  }
  if (largest) return largest;

  return pickJb2aVariant(enriched, worldSpan);
}

const GENERIC_BURST: Jb2aEffectAsset = {
  basename: '3rd_Level/Fireball/FireballExplosion_01_Orange',
  dpi: 200,
  variants: { '800': { suffix: '800x800', width: 800, height: 800, durationMs: 4040 } },
};

const GENERIC_CONE: Jb2aEffectAsset = {
  basename: '1st_Level/Burning_Hands/BurningHands_01_Regular_Orange',
  dpi: 600,
  variants: { '600': { suffix: '600x600', width: 600, height: 600, durationMs: 5570 } },
  directed: true,
};

const GENERIC_LINE: Jb2aEffectAsset = {
  basename: '3rd_Level/Lightning_Bolt/LightningBolt_01_Regular_Blue',
  dpi: 200,
  variants: { '4000': { suffix: '4000x200', width: 4000, height: 200, durationMs: 4000 } },
  directed: true,
};

const GENERIC_ZONE: Jb2aEffectAsset = {
  basename: '1st_Level/Fog_Cloud/FogCloud_01_White',
  dpi: 200,
  variants: { '800': { suffix: '800x800', width: 800, height: 800, durationMs: 5040 } },
};

const AOE_FALLBACK: Record<string, Jb2aEffectAsset> = {
  cone: GENERIC_CONE,
  line: GENERIC_LINE,
  cube: GENERIC_BURST,
  square: GENERIC_BURST,
  radius: GENERIC_BURST,
  sphere: GENERIC_BURST,
  circle: GENERIC_BURST,
  cylinder: GENERIC_BURST,
};

export function resolveSpellJb2aMapping(spellName: string, aoeType?: string): SpellJb2aMapping {
  const entry = findSpellEffectCatalogEntry(spellName);
  if (entry) {
    const cast = withBeamVariants(catalogEntryToJb2aAsset(entry));
    const mapping: SpellJb2aMapping = {
      cast,
      ...(entry.hasZoneLoop ? { zone: cast } : {}),
    };
    const impact = SPELL_IMPACT_ASSETS[entry.id] ?? SPELL_IMPACT_ASSETS[spellName.trim().toLowerCase()];
    if (impact) mapping.impact = impact;
    return mapping;
  }

  const t = (aoeType ?? '').toLowerCase();
  const fallback = AOE_FALLBACK[t];
  if (fallback) return { cast: fallback, zone: GENERIC_ZONE };
  return { cast: GENERIC_BURST, zone: GENERIC_ZONE };
}

export function pickJb2aVariant(asset: Jb2aEffectAsset, targetPx: number): Jb2aVariant {
  const keys = Object.keys(asset.variants);
  if (keys.length === 0) {
    throw new Error(`JB2A asset has no variants: ${asset.basename}`);
  }
  const targetAtDpi = targetPx * asset.dpi;
  let bestKey = keys[0]!;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const dist = Math.abs(parseInt(key, 10) - targetAtDpi);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = key;
    }
  }
  return asset.variants[bestKey]!;
}

export function jb2aAssetUrl(baseUrl: string, asset: Jb2aEffectAsset, variant: Jb2aVariant): string {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}/${asset.basename}_${variant.suffix}.webm`;
}
