import type { SpellEffectCatalogEntry } from './spellEffectsCatalog';

/** How projectiles / target picks scale when upcasting. */
export interface SpellProjectileScaling {
  /** Minimum slot level for this spell (1 = 1st, 0 = cantrip). */
  baseLevel: number;
  /** Projectiles (or target picks) at base level. */
  baseCount: number;
  /** +N projectiles per slot level above baseLevel. */
  perLevelAbove: number;
  /** One-time bonus when cast at this level or higher (e.g. Chain Lightning 7th). */
  bonusFromLevel?: number;
  bonusCount?: number;
  maxCount?: number;
}

/** Spells where upcasting changes projectile / target count. */
const PROJECTILE_SCALING: Record<string, SpellProjectileScaling> = {
  magic_missile: { baseLevel: 1, baseCount: 3, perLevelAbove: 1, maxCount: 9 },
  scorching_ray: { baseLevel: 2, baseCount: 3, perLevelAbove: 1, maxCount: 9 },
  chain_lightning: { baseLevel: 6, baseCount: 4, perLevelAbove: 0, bonusFromLevel: 7, bonusCount: 1 },
};

export function getSpellProjectileScaling(catalogId?: string): SpellProjectileScaling | undefined {
  if (!catalogId) return undefined;
  return PROJECTILE_SCALING[catalogId];
}

export function spellSupportsLevelScaling(catalogId?: string): boolean {
  return getSpellProjectileScaling(catalogId) != null;
}

export function defaultCastLevel(
  entry?: SpellEffectCatalogEntry,
  compendiumLevel?: number,
): number {
  const scaling = getSpellProjectileScaling(entry?.id);
  if (compendiumLevel != null && Number.isFinite(compendiumLevel)) {
    const min = scaling?.baseLevel ?? 0;
    return Math.max(min, compendiumLevel);
  }
  if (scaling) return scaling.baseLevel;
  return compendiumLevel ?? 1;
}

export function resolveProjectileCount(catalogId: string, castLevel: number): number | null {
  const s = PROJECTILE_SCALING[catalogId];
  if (!s) return null;

  const level = Math.max(s.baseLevel, castLevel);
  let count = s.baseCount + Math.max(0, level - s.baseLevel) * s.perLevelAbove;
  if (s.bonusFromLevel != null && level >= s.bonusFromLevel) {
    count += s.bonusCount ?? 1;
  }
  if (s.maxCount != null) count = Math.min(count, s.maxCount);
  return Math.max(1, count);
}

export function formatCastLevel(level: number): string {
  if (level <= 0) return 'Cantrip';
  const suffix = level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th';
  return `${level}${suffix}`;
}

/** Spells where each projectile can be assigned to the same target (Magic Missile, Scorching Ray). */
const REPEAT_TARGET_SPELLS = new Set(['magic_missile', 'scorching_ray']);

export function spellAllowsRepeatTargets(catalogId?: string): boolean {
  return catalogId != null && REPEAT_TARGET_SPELLS.has(catalogId);
}

/** Final shot list — honors explicit per-missile assignments (duplicates allowed). */
export function resolveShotTargetIds(
  targetIds: string[],
  projectileCount?: number | null,
): string[] {
  if (targetIds.length === 0) return [];
  if (projectileCount == null || projectileCount <= 0) return targetIds;
  if (targetIds.length === projectileCount) return targetIds;
  const hasExplicitRepeats = new Set(targetIds).size < targetIds.length;
  if (hasExplicitRepeats) {
    return targetIds.length > projectileCount
      ? targetIds.slice(0, projectileCount)
      : distributeProjectilesToTargets(targetIds, projectileCount);
  }
  return distributeProjectilesToTargets(targetIds, projectileCount);
}

/** Spread N projectiles across selected targets (repeat targets allowed). */
export function distributeProjectilesToTargets(targetIds: string[], projectileCount: number): string[] {
  if (targetIds.length === 0 || projectileCount <= 0) return [];
  const out: string[] = [];
  for (let i = 0; i < projectileCount; i++) {
    out.push(targetIds[i % targetIds.length]!);
  }
  return out;
}

export function resolveScaledMaxTargets(
  entry?: SpellEffectCatalogEntry,
  castLevel?: number,
): number {
  if (!entry) return 0;

  const level = castLevel ?? defaultCastLevel(entry);
  const scaled = resolveProjectileCount(entry.id, level);
  if (scaled != null) return scaled;

  if (entry.maxTargets != null) return entry.maxTargets;
  if (entry.castMode === 'melee' || entry.castMode === 'ranged') return 1;
  return 0;
}

export function scalingSummary(entry: SpellEffectCatalogEntry, castLevel: number): string | null {
  const count = resolveProjectileCount(entry.id, castLevel);
  if (count == null) return null;
  const scaling = getSpellProjectileScaling(entry.id)!;
  if (castLevel <= scaling.baseLevel && count === scaling.baseCount) {
    return `${count} projectile${count === 1 ? '' : 's'}`;
  }
  return `${count} projectile${count === 1 ? '' : 's'} at ${formatCastLevel(castLevel)} level`;
}
