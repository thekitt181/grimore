import type { GrimoireCharacter, CompendiumMonster } from '@grimoire/shared';
import { queryClient } from '@/lib/queryClient';
import type { TokenItem } from '@/systems/scene/types';
import { scaleDamage, type DamageMultiplier } from './damageMultiplier';

const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;

export interface TokenDamageDefenses {
  resistances: string[];
  immunities: string[];
  vulnerabilities: string[];
}

export type DefenseAdjustment = 'immune' | 'resistant' | 'vulnerable';

export function normalizeDamageType(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/** Extract damage type from labels like "2d6 fire", "cold damage", or action names "Cold Breath". */
export function parseDamageTypeFromLabel(label: string): string | null {
  const lower = label.toLowerCase();
  for (const type of DAMAGE_TYPES) {
    if (new RegExp(`\\b${type}\\b`).test(lower)) return type;
  }
  return null;
}

/** Resolve a concrete damage type from explicit fields, labels, or action names. */
export function resolveDamageType(...sources: (string | null | undefined)[]): string | null {
  for (const src of sources) {
    if (!src?.trim()) continue;
    const parsed = parseDamageTypeFromLabel(src);
    if (parsed) return parsed;
    const norm = normalizeDamageType(src);
    if ((DAMAGE_TYPES as readonly string[]).includes(norm)) return norm;
  }
  return null;
}

function splitDefenseEntries(raw: string): string[] {
  return raw
    .split(/[,;]|\band\b|\bor\b/i)
    .map((part) => part.trim())
    .filter(Boolean);
}

function damageTypesMatch(incomingType: string, defenseLabel: string): boolean {
  const incoming = normalizeDamageType(incomingType);
  if (!incoming) return false;

  const defenseNorm = normalizeDamageType(defenseLabel);
  if (!defenseNorm) return false;
  if (incoming === defenseNorm) return true;
  if (defenseNorm.includes(incoming) || incoming.includes(defenseNorm)) return true;

  for (const type of DAMAGE_TYPES) {
    if (defenseLabel.toLowerCase().includes(type) && incoming === type) return true;
  }
  return false;
}

function hasDefense(defenses: string[], damageType: string): boolean {
  for (const entry of defenses) {
    for (const part of splitDefenseEntries(entry)) {
      if (damageTypesMatch(damageType, part)) return true;
    }
  }
  return false;
}

export function getCachedTokenDefenses(token: TokenItem): TokenDamageDefenses {
  const empty: TokenDamageDefenses = { resistances: [], immunities: [], vulnerabilities: [] };

  if (token.ddbCharacterId) {
    const ch = queryClient.getQueryData<GrimoireCharacter>(['ddb', 'character', token.ddbCharacterId]);
    if (ch) {
      return {
        resistances: ch.damageResistances ?? [],
        immunities: ch.damageImmunities ?? [],
        vulnerabilities: ch.damageVulnerabilities ?? [],
      };
    }
  }

  if (token.monsterId) {
    const monster = queryClient.getQueryData<CompendiumMonster>(['compendium', 'monster', token.monsterId]);
    if (monster) {
      return {
        resistances: monster.damageResistances ?? [],
        immunities: monster.damageImmunities ?? [],
        vulnerabilities: monster.damageVulnerabilities ?? [],
      };
    }
  }

  return empty;
}

export function getDefenseAdjustment(
  defenses: TokenDamageDefenses,
  damageType: string | null | undefined,
): DefenseAdjustment | null {
  const resolved = resolveDamageType(damageType);
  if (!resolved) return null;
  if (hasDefense(defenses.immunities, resolved)) return 'immune';
  if (hasDefense(defenses.vulnerabilities, resolved)) return 'vulnerable';
  if (hasDefense(defenses.resistances, resolved)) return 'resistant';
  return null;
}

/** Apply save multiplier first, then resistance / immunity / vulnerability. */
export function computeFinalDamage(
  base: number,
  saveMultiplier: DamageMultiplier,
  adjustment: DefenseAdjustment | null,
): number {
  let amount = scaleDamage(base, saveMultiplier);
  if (adjustment === 'immune') return 0;
  if (adjustment === 'vulnerable') amount *= 2;
  if (adjustment === 'resistant') amount = Math.floor(amount / 2);
  return Math.max(0, amount);
}

export function formatFinalDamage(
  base: number,
  saveMultiplier: DamageMultiplier,
  adjustment: DefenseAdjustment | null,
): string {
  const final = computeFinalDamage(base, saveMultiplier, adjustment);
  if (saveMultiplier === 'normal' && !adjustment) return String(final);

  const parts: string[] = [];
  if (saveMultiplier !== 'normal') parts.push(`${saveMultiplier} save`);
  if (adjustment === 'resistant') parts.push('resist');
  if (adjustment === 'immune') parts.push('immune');
  if (adjustment === 'vulnerable') parts.push('vulnerable');

  return parts.length ? `${final} (${parts.join(', ')})` : String(final);
}

export const DEFENSE_BADGE: Record<DefenseAdjustment, { label: string; color: string }> = {
  immune: { label: 'Immune', color: '#86efac' },
  resistant: { label: 'Resist', color: '#93c5fd' },
  vulnerable: { label: 'Vuln', color: '#fca5a5' },
};
