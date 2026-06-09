/* eslint-disable @typescript-eslint/no-explicit-any */
import { collectModifiers } from './attackExtract';
import type { GrimoireFeature } from '@grimoire/shared';

const CONDITION_SUBTYPES = new Set([
  'blinded',
  'charmed',
  'deafened',
  'exhaustion',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'magical-sleep',
  'sleep',
  'disease',
]);

function titleCaseSlug(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function modifierLabel(mod: any): string {
  const friendly = mod.friendlySubtypeName ?? mod.friendlySubTypeName;
  if (typeof friendly === 'string' && friendly.trim()) return friendly.trim();
  const sub = String(mod.subType ?? '').trim();
  return sub ? titleCaseSlug(sub) : 'Unknown';
}

/** Skip spell-granted modifiers that apply to targets, not the character sheet. */
function isCharacterDefenseModifier(mod: any): boolean {
  const id = String(mod.id ?? '');
  if (id.startsWith('spell_')) return false;
  const restriction = String(mod.restriction ?? '').toLowerCase();
  if (restriction.includes('against target')) return false;
  if (restriction.includes('chosen creature')) return false;
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

export function extractFeats(raw: any): GrimoireFeature[] {
  const out: GrimoireFeature[] = [];
  for (const feat of raw.feats ?? []) {
    const def = feat.definition ?? {};
    const name = def.name ?? feat.name;
    if (!name) continue;
    out.push({
      id: String(def.id ?? feat.componentId ?? name),
      name: String(name),
      description: def.snippet ?? def.description ?? undefined,
    });
  }
  return out;
}

export function extractDeathSaves(raw: any): {
  successes: number;
  failures: number;
  stabilized: boolean;
} {
  const ds = raw.deathSaves ?? {};
  return {
    successes: Number(ds.successCount ?? 0) || 0,
    failures: Number(ds.failCount ?? 0) || 0,
    stabilized: Boolean(ds.isStabilized),
  };
}

export function extractDefenses(raw: any): {
  damageResistances: string[];
  damageImmunities: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
} {
  const resistances: string[] = [];
  const immunities: string[] = [];
  const vulnerabilities: string[] = [];
  const conditionImmunities: string[] = [];

  for (const mod of collectModifiers(raw)) {
    if (!isCharacterDefenseModifier(mod)) continue;
    const type = String(mod.type ?? '').toLowerCase();
    if (type !== 'resistance' && type !== 'immunity' && type !== 'vulnerability') continue;

    const label = modifierLabel(mod);
    const subType = String(mod.subType ?? '').toLowerCase();
    const isCondition = CONDITION_SUBTYPES.has(subType);

    if (type === 'immunity' && isCondition) {
      conditionImmunities.push(label);
    } else if (type === 'resistance') {
      resistances.push(label);
    } else if (type === 'immunity') {
      immunities.push(label);
    } else if (type === 'vulnerability') {
      vulnerabilities.push(label);
    }
  }

  for (const entry of raw.customDefenseAdjustments ?? []) {
    const label = String(entry?.name ?? entry?.value ?? entry?.type ?? '').trim();
    if (!label) continue;
    const kind = String(entry?.type ?? entry?.defenseType ?? '').toLowerCase();
    if (kind.includes('vulner')) vulnerabilities.push(label);
    else if (kind.includes('immune')) immunities.push(label);
    else resistances.push(label);
  }

  return {
    damageResistances: uniqueSorted(resistances),
    damageImmunities: uniqueSorted(immunities),
    damageVulnerabilities: uniqueSorted(vulnerabilities),
    conditionImmunities: uniqueSorted(conditionImmunities),
  };
}
