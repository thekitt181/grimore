/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeAbilityName, type GrimoireAbility, type GrimoireSave, type GrimoireSkill } from '@grimoire/shared';
import { collectModifiers, pickNumber } from './attackExtract';

const ABILITY_ORDER = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'] as const;

const SAVE_SUBTYPES: Record<string, string> = {
  STR: 'strength-saving-throws',
  DEX: 'dexterity-saving-throws',
  CON: 'constitution-saving-throws',
  INT: 'intelligence-saving-throws',
  WIS: 'wisdom-saving-throws',
  CHA: 'charisma-saving-throws',
};

const STANDARD_SKILLS: { name: string; ability: string; key: string }[] = [
  { name: 'Acrobatics', ability: 'DEX', key: 'acrobatics' },
  { name: 'Animal Handling', ability: 'WIS', key: 'animal-handling' },
  { name: 'Arcana', ability: 'INT', key: 'arcana' },
  { name: 'Athletics', ability: 'STR', key: 'athletics' },
  { name: 'Deception', ability: 'CHA', key: 'deception' },
  { name: 'History', ability: 'INT', key: 'history' },
  { name: 'Insight', ability: 'WIS', key: 'insight' },
  { name: 'Intimidation', ability: 'CHA', key: 'intimidation' },
  { name: 'Investigation', ability: 'INT', key: 'investigation' },
  { name: 'Medicine', ability: 'WIS', key: 'medicine' },
  { name: 'Nature', ability: 'INT', key: 'nature' },
  { name: 'Perception', ability: 'WIS', key: 'perception' },
  { name: 'Performance', ability: 'CHA', key: 'performance' },
  { name: 'Persuasion', ability: 'CHA', key: 'persuasion' },
  { name: 'Religion', ability: 'INT', key: 'religion' },
  { name: 'Sleight of Hand', ability: 'DEX', key: 'sleight-of-hand' },
  { name: 'Stealth', ability: 'DEX', key: 'stealth' },
  { name: 'Survival', ability: 'WIS', key: 'survival' },
];

function abilityMod(score: number): number {
  return Math.floor((score - 10) / 2);
}

function statArrayValue(arr: any[], index: number): number {
  const entry = arr[index];
  if (!entry) return 0;
  return pickNumber(entry.value, entry.score) ?? 0;
}

function abilityScoreFromModifiers(raw: any): {
  bonuses: Record<string, number>;
  overrides: Record<string, number>;
} {
  const bonuses: Record<string, number> = {};
  const overrides: Record<string, number> = {};

  for (const m of collectModifiers(raw)) {
    const sub = String(m.subType ?? m.friendlySubtypeName ?? '').toLowerCase();
    const match = sub.match(
      /^(strength|dexterity|constitution|intelligence|wisdom|charisma)-score$/,
    );
    if (!match?.[1]) continue;

    const name = normalizeAbilityName(match[1]);
    const val = pickNumber(m.value, m.fixedValue) ?? 0;
    if (!Number.isFinite(val) || val === 0) continue;

    if (m.type === 'set') overrides[name] = Math.max(overrides[name] ?? 0, val);
    if (m.type === 'bonus') bonuses[name] = (bonuses[name] ?? 0) + val;
  }

  return { bonuses, overrides };
}

/** DDB splits base scores, item/feat bonuses, and overrides (e.g. Belt of Giant Strength). */
export function extractAbilities(raw: any): GrimoireAbility[] {
  const base = raw.stats ?? [];
  const bonusArr = raw.bonusStats ?? [];
  const overrideArr = raw.overrideStats ?? [];
  const { bonuses: modBonuses, overrides: modOverrides } = abilityScoreFromModifiers(raw);

  return ABILITY_ORDER.map((name, i) => {
    let score = statArrayValue(base, i) || 10;

    const bonusFromArray = statArrayValue(bonusArr, i);
    score += bonusFromArray;
    if (bonusFromArray === 0) score += modBonuses[name] ?? 0;

    const overrideFromArray = statArrayValue(overrideArr, i);
    if (overrideFromArray > 0) score = overrideFromArray;
    else if ((modOverrides[name] ?? 0) > 0) score = modOverrides[name]!;

    return { name, score, mod: abilityMod(score) };
  });
}

export function extractProficiencyBonus(raw: any): number {
  const direct = pickNumber(raw.proficiencyBonus, raw.profBonus);
  if (direct != null) return direct;

  const classLevels = (raw.classes ?? []).reduce(
    (sum: number, c: any) => sum + (pickNumber(c.level) ?? 0),
    0,
  );
  const level = classLevels || pickNumber(raw.level) || 1;
  return Math.floor((level - 1) / 4) + 2;
}

function collectProficiencies(raw: any): Set<string> {
  const keys = new Set<string>();
  for (const m of collectModifiers(raw)) {
    if (m.type !== 'proficiency' && m.type !== 'expertise') continue;
    const sub = String(m.subType ?? m.friendlySubtypeName ?? '')
      .toLowerCase()
      .replace(/\s+/g, '-');
    if (sub) keys.add(sub);
  }
  return keys;
}

function collectSkillBonuses(raw: any): Map<string, number> {
  const bonuses = new Map<string, number>();
  for (const m of collectModifiers(raw)) {
    if (m.type !== 'bonus' && m.type !== 'skill') continue;
    const sub = String(m.subType ?? m.friendlySubtypeName ?? '')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const val = pickNumber(m.value, m.fixedValue);
    if (!sub || val == null) continue;
    bonuses.set(sub, (bonuses.get(sub) ?? 0) + val);
  }
  return bonuses;
}

function collectFinalSkillMods(raw: any): Map<string, number> {
  const finals = new Map<string, number>();
  for (const m of collectModifiers(raw)) {
    if (m.type !== 'skill') continue;
    const sub = String(m.subType ?? m.friendlySubtypeName ?? '')
      .toLowerCase()
      .replace(/\s+/g, '-');
    const val = pickNumber(m.value, m.fixedValue);
    if (sub && val != null) finals.set(sub, val);
  }
  return finals;
}

export function extractSkills(
  raw: any,
  abilities: GrimoireAbility[],
  proficiencyBonus: number,
): GrimoireSkill[] {
  const proficiencies = collectProficiencies(raw);
  const skillBonuses = collectSkillBonuses(raw);
  const finalMods = collectFinalSkillMods(raw);
  const abilityMods = Object.fromEntries(abilities.map((a) => [a.name, a.mod]));

  return STANDARD_SKILLS.map(({ name, ability, key }) => {
    const final = finalMods.get(key);
    if (final != null) {
      return { name, mod: final, proficient: proficiencies.has(key) };
    }

    const proficient = proficiencies.has(key);
    const base = abilityMods[ability] ?? 0;
    const bonus = skillBonuses.get(key) ?? 0;
    const mod = base + (proficient ? proficiencyBonus : 0) + bonus;
    return { name, mod, proficient };
  });
}

export function extractSaves(
  raw: any,
  abilities: GrimoireAbility[],
  proficiencyBonus: number,
): GrimoireSave[] {
  const proficiencies = collectProficiencies(raw);
  const abilityMods = Object.fromEntries(abilities.map((a) => [a.name, a.mod]));

  return ABILITY_ORDER.map((name) => {
    const saveKey = SAVE_SUBTYPES[name] ?? `${name.toLowerCase()}-saving-throws`;

    for (const m of collectModifiers(raw)) {
      if (m.type === 'save' || m.type === 'saving-throw') {
        const sub = String(m.subType ?? m.friendlySubtypeName ?? '').toLowerCase();
        if (sub === saveKey || sub.includes(name.toLowerCase())) {
          const val = pickNumber(m.value, m.fixedValue);
          if (val != null) {
            return { name, mod: val, proficient: true };
          }
        }
      }
    }

    const proficient = proficiencies.has(saveKey);
    const base = abilityMods[name] ?? 0;
    return {
      name,
      mod: base + (proficient ? proficiencyBonus : 0),
      proficient,
    };
  });
}
