import { extractAllAttacks, isWeaponAttackEntry } from './attackExtract';
import {
  extractAbilities,
  extractProficiencyBonus,
  extractSaves,
  extractSkills,
} from './abilitiesExtract';
import { extractAc, extractVitals } from './vitalsExtract';
import { extractDarkvisionFt } from './sensesExtract';
import { extractDeathSaves, extractDefenses, extractFeats } from './traitsExtract';
import {
  normalizeAbilityName,
  normalizeDiceNotation,
  type GrimoireAbility,
  type GrimoireCharacter,
  type GrimoireFeature,
  type GrimoireInventoryItem,
  type GrimoireSpell,
  type GrimoireSpellSlots,
} from '@grimoire/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

function parseAoe(definition: any): { size: number; type: string } | undefined {
  const range = definition?.range ?? definition?.activation?.range;
  if (!range) return undefined;
  const type = (range.rangeType ?? range.type ?? '').toLowerCase();
  const size = range.rangeValue ?? range.distance ?? range.size;
  if (!type || size == null) return undefined;
  return { size: Number(size), type: type === 'sphere' ? 'radius' : type };
}

export function normalizeCharacter(raw: any, ddbCharacterId: number): GrimoireCharacter {
  const abilities = extractAbilities(raw);
  const proficiencyBonus = extractProficiencyBonus(raw);
  const saves = extractSaves(raw, abilities, proficiencyBonus);
  const skills = extractSkills(raw, abilities, proficiencyBonus);

  const classes = (raw.classes ?? []).map(
    (c: any) => `${c.definition?.name ?? c.className ?? 'Class'} ${c.level ?? ''}`.trim(),
  );

  const attacks = extractAllAttacks(raw, abilities);
  const actionFeatures: GrimoireFeature[] = [];

  for (const [source, list] of [
    ['class', raw.actions?.class ?? []],
    ['race', raw.actions?.race ?? []],
    ['feat', raw.actions?.feat ?? []],
  ] as const) {
    for (const action of list) {
      if (isWeaponAttackEntry(action, source)) continue;
      const name = action?.name ?? action?.definition?.name;
      if (!name) continue;
      actionFeatures.push({
        id: `${source}-${action.id ?? name}`,
        name: String(name),
        description:
          action.definition?.description
          ?? action.snippet
          ?? action.description
          ?? (normalizeDiceNotation(action.dice ?? action.damage) || undefined),
      });
    }
  }

  const spells: GrimoireSpell[] = [];
  const spellGroups = [
    ...(raw.classSpells ?? []),
    ...(raw.spells?.class ?? []),
    ...(raw.spells?.race ?? []),
    ...(raw.spells?.feat ?? []),
    ...(raw.spells?.item ?? []),
  ];
  for (const entry of spellGroups) {
    const def = entry.definition ?? entry.spellDefinition ?? entry;
    if (!def?.name) continue;
    const level = def.level ?? entry.level ?? 0;
    const damage = def.damage ?? def.atHigherLevels;
    spells.push({
      id: String(def.id ?? def.name),
      name: def.name,
      level,
      school: def.school,
      damage: normalizeDiceNotation(damage) || undefined,
      damageType: def.damageType ?? def.damageTypeName,
      save: def.saveDcAbilityId ? abilityName(def.saveDcAbilityId) : undefined,
      attack: Boolean(def.attackType || def.requiresAttackRoll),
      aoe: parseAoe(def),
      prepared: entry.prepared ?? entry.alwaysPrepared ?? level === 0,
      ritual: def.ritual ?? false,
      concentration: def.concentration ?? false,
    });
  }

  const spellSlots: GrimoireSpellSlots[] = (raw.classSpells ?? [])
    .flatMap((c: any) => c.spells ?? [])
    .length
    ? []
    : (raw.spellSlots ?? raw.slots ?? []).map((s: any, i: number) => ({
        level: s.level ?? i + 1,
        total: s.max ?? s.total ?? 0,
        used: s.used ?? 0,
      }));

  if (spellSlots.length === 0 && raw.classes?.[0]?.spellSlots) {
    const slots = raw.classes[0].spellSlots;
    for (let i = 1; i <= 9; i++) {
      const s = slots[`level${i}`] ?? slots[i];
      if (s && (s.max > 0 || s.total > 0)) {
        spellSlots.push({ level: i, total: s.max ?? s.total ?? 0, used: s.used ?? 0 });
      }
    }
  }

  const inventory: GrimoireInventoryItem[] = (raw.inventory ?? []).map((item: any) => ({
    id: String(item.id ?? item.definitionId ?? item.name),
    name: item.definition?.name ?? item.name ?? 'Item',
    quantity: item.quantity ?? 1,
    weight: item.weight ?? item.definition?.weight,
    equipped: item.equipped ?? false,
    type: item.definition?.type,
  }));

  const features: GrimoireFeature[] = [
    ...(raw.classFeatures ?? raw.features?.class ?? []).map((f: any) => ({
      id: String(f.id ?? f.definitionId ?? f.name),
      name: f.definition?.name ?? f.name ?? 'Feature',
      description: f.definition?.description ?? f.description,
    })),
    ...actionFeatures,
  ];

  const decorations = raw.decorations ?? {};
  const avatarUrl =
    decorations.avatarUrl ?? decorations.largeAvatarUrl ?? raw.avatarUrl ?? undefined;

  const { hp, maxHp, tempHp } = extractVitals(raw);
  const defenses = extractDefenses(raw);
  const feats = extractFeats(raw);
  const deathSaves = extractDeathSaves(raw);
  const darkvisionFt = extractDarkvisionFt(raw);

  return {
    ddbCharacterId,
    name: raw.name ?? 'Character',
    level: raw.level ?? (classes.reduce((n: number, c: string) => n + parseInt(c.match(/\d+/)?.[0] ?? '0', 10), 0) || 1),
    classes: classes.length ? classes : ['Adventurer'],
    race: raw.race?.fullName ?? raw.race?.baseName ?? raw.race?.name,
    avatarUrl,
    campaignId: raw.campaign?.id ? Number(raw.campaign.id) : undefined,
    campaignName: raw.campaign?.name,
    hp,
    maxHp,
    tempHp,
    ac: extractAc(raw),
    inspiration: Boolean(raw.inspiration),
    deathSaves,
    abilities: abilities.length ? abilities : defaultAbilities(),
    skills,
    saves: saves.length ? saves : defaultSaves(abilities),
    attacks,
    spells,
    spellSlots,
    inventory,
    features,
    feats,
    conditions: (raw.conditions ?? []).map((c: any) => c.name ?? String(c)),
    damageResistances: defenses.damageResistances,
    damageImmunities: defenses.damageImmunities,
    damageVulnerabilities: defenses.damageVulnerabilities,
    conditionImmunities: defenses.conditionImmunities,
    darkvisionFt,
    spellSaveDc: raw.spellSaveDc ?? raw.baseSpellcastingAbilitySaveDc,
    spellAttackMod: raw.spellAttackModifier ?? raw.baseSpellcastingAbilityAttackMod,
    proficiencyBonus,
    updateId: raw.updateId ?? raw.revision ?? 0,
    lastSyncedAt: new Date().toISOString(),
  };
}

function abilityName(id: number | string): string {
  return normalizeAbilityName(id) || 'DEX';
}

function defaultAbilities(): GrimoireAbility[] {
  return ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((name) => ({
    name,
    score: 10,
    mod: 0,
  }));
}

function defaultSaves(abilities: GrimoireAbility[]): { name: string; mod: number; proficient: boolean }[] {
  return abilities.map((a) => ({ name: a.name, mod: a.mod, proficient: false }));
}
