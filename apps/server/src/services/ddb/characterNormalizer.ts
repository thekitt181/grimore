import { stripDdbHtml } from './ddbHtml';
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
  type FeatureActivation,
  type GrimoireAbility,
  type GrimoireCharacter,
  type GrimoireFeature,
  type GrimoireInventoryItem,
  type GrimoireSpell,
  type GrimoireSpellSlots,
} from '@grimoire/shared';

/* eslint-disable @typescript-eslint/no-explicit-any */

const DDB_RESET_LABEL: Record<number, string> = {
  1: 'Short Rest',
  2: 'Long Rest',
  3: 'Dawn',
  4: 'Dusk',
  5: 'Recharge',
};

function ddbResetLabel(resetType: unknown, description: unknown): string | undefined {
  const n = Number(resetType);
  const fromType = Number.isFinite(n) ? DDB_RESET_LABEL[n] : undefined;
  if (fromType) return fromType;
  const desc = typeof description === 'string' ? description.trim() : '';
  return desc || undefined;
}

function extractLimitedUses(
  source: any,
  ctx?: { abilities?: GrimoireAbility[]; proficiencyBonus?: number },
): Pick<GrimoireInventoryItem, 'usesMax' | 'usesUsed' | 'usesRemaining' | 'usesReset'> {
  const lu = source.limitedUse ?? source.definition?.limitedUse ?? null;
  let max = Number(
    lu?.maxUses
    ?? lu?.maxNumberOfUses
    ?? lu?.maxUseCount
    ?? source.charges
    ?? source.definition?.charges
    ?? 0,
  );
  if (!Number.isFinite(max)) max = 0;

  const statId = lu?.statModifierUsesId ?? lu?.statModifierUses;
  if (statId != null && ctx?.abilities?.length) {
    const mod = ctx.abilities.find((a) => a.name === normalizeAbilityName(statId))?.mod ?? 0;
    const op = Number(lu?.operator ?? 1);
    max = op === 2 ? (max === 0 ? mod : max * mod) : max + mod;
  }
  if (lu?.useProficiencyBonus && ctx?.proficiencyBonus != null) {
    const op = Number(lu?.proficiencyBonusOperator ?? 1);
    max = op === 2
      ? (max === 0 ? ctx.proficiencyBonus : max * ctx.proficiencyBonus)
      : max + ctx.proficiencyBonus;
  }

  if (max <= 0) return {};
  const usedRaw = Number(lu?.numberUsed ?? lu?.numberOfUses ?? source.chargesUsed ?? 0);
  const used = Number.isFinite(usedRaw) ? Math.max(0, usedRaw) : 0;
  const remaining = Math.max(0, max - used);
  const reset = ddbResetLabel(lu?.resetType, lu?.resetTypeDescription ?? lu?.resetTypeName);
  return {
    usesMax: max,
    usesUsed: used,
    usesRemaining: remaining,
    ...(reset ? { usesReset: reset } : {}),
  };
}

function mapActivation(raw: any): FeatureActivation | undefined {
  const type = Number(raw?.activation?.activationType ?? raw?.activationType ?? raw?.activation?.type);
  if (type === 1) return 'action';
  if (type === 3) return 'bonus';
  if (type === 4) return 'reaction';
  if (type === 8) return 'legendary';
  if (type === 9) return 'lair';
  if (type === 2 || type === 7) return 'special';
  return undefined;
}

function normalizeDdbFeature(
  raw: any,
  fallbackId: string,
  ctx: { abilities: GrimoireAbility[]; proficiencyBonus: number },
): GrimoireFeature | null {
  const def = raw?.definition ?? {};
  const name = String(raw?.name ?? def.name ?? '').trim();
  if (!name) return null;
  const description = stripDdbHtml(def.description ?? raw.snippet ?? raw.description ?? '');
  const activation = mapActivation(raw);
  const uses = extractLimitedUses(raw, ctx);
  return {
    id: String(raw.id ?? def.id ?? fallbackId),
    name,
    ...(description ? { description } : {}),
    ...(activation ? { activation } : {}),
    ...uses,
  };
}

function mergeFeature(list: GrimoireFeature[], next: GrimoireFeature): void {
  const i = list.findIndex((f) => f.name.trim().toLowerCase() === next.name.trim().toLowerCase());
  if (i < 0) {
    list.push(next);
    return;
  }
  const cur = list[i]!;
  list[i] = {
    ...cur,
    ...next,
    id: cur.id,
    description: next.description || cur.description,
    activation: next.activation ?? cur.activation,
    usesMax: next.usesMax ?? cur.usesMax,
    usesUsed: next.usesUsed ?? cur.usesUsed,
    usesRemaining: next.usesRemaining ?? cur.usesRemaining,
    usesReset: next.usesReset ?? cur.usesReset,
  };
}

function normalizeInventoryItem(item: any): GrimoireInventoryItem {
  const def = item.definition ?? {};
  const description = stripDdbHtml(def.description ?? def.snippet ?? item.notes ?? '');
  const notes = stripDdbHtml(item.notes ?? '');
  const fullText = [description, notes && notes !== description ? `Notes: ${notes}` : '']
    .filter(Boolean)
    .join('\n\n');
  const rarity = typeof def.rarity === 'string' ? def.rarity : undefined;
  const type = typeof def.type === 'string' ? def.type : undefined;
  const imageUrl = def.avatarUrl ?? def.largeAvatarUrl ?? undefined;
  const weight = item.weight ?? def.weight;
  const uses = extractLimitedUses(item);

  return {
    id: String(item.id ?? item.definitionId ?? item.name),
    name: def.name ?? item.name ?? 'Item',
    quantity: item.quantity ?? 1,
    equipped: item.equipped ?? false,
    ...(type ? { type } : {}),
    ...(rarity ? { rarity } : {}),
    ...(fullText ? { description: fullText } : {}),
    ...(typeof imageUrl === 'string' && imageUrl ? { imageUrl } : {}),
    ...(typeof weight === 'number' ? { weight } : {}),
    ...uses,
  };
}

function collectSpellEntries(raw: any): any[] {
  const out: any[] = [];
  const pushList = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (Array.isArray(entry?.spells)) out.push(...entry.spells);
      else if (entry) out.push(entry);
    }
  };
  pushList(raw.classSpells);
  pushList(raw.spells?.class);
  pushList(raw.spells?.race);
  pushList(raw.spells?.feat);
  pushList(raw.spells?.item);
  pushList(raw.spells?.alwaysPrepared);
  return out;
}

const DDB_ACTIVATION: Record<number, string> = {
  1: 'Action',
  3: 'Bonus Action',
  4: 'Reaction',
};

const DDB_DURATION_UNIT: Record<number, string> = {
  1: 'round',
  2: 'minute',
  3: 'hour',
  4: 'day',
};

function formatSpellSchool(def: any): string | undefined {
  const school = def.school ?? def.definition?.school;
  if (typeof school === 'string' && school.trim()) return school.trim();
  if (school && typeof school === 'object' && typeof school.name === 'string') return school.name.trim();
  return undefined;
}

function formatSpellCastingTime(def: any): string | undefined {
  const direct = def.castingTimeDescription ?? def.activation?.activationTimeDescription;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const type = Number(def.activation?.activationType ?? def.activationType);
  const n = Number(def.activation?.activationTime ?? def.activationTime ?? 1) || 1;
  const label = DDB_ACTIVATION[type];
  if (!label) return undefined;
  return n === 1 ? `1 ${label}` : `${n} ${label}s`;
}

function formatSpellRangeText(def: any): string | undefined {
  const direct = def.rangeDescription ?? def.range?.description;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const range = def.range ?? {};
  const origin = String(range.origin ?? range.rangeType ?? '').trim();
  const value = Number(range.rangeValue ?? range.distance ?? range.value);
  if (/self/i.test(origin) && !(Number.isFinite(value) && value > 0)) return 'Self';
  if (/touch/i.test(origin)) return 'Touch';
  if (Number.isFinite(value) && value > 0) return `${value} feet`;
  if (origin) return origin;
  return undefined;
}

function formatSpellComponents(def: any): string | undefined {
  const direct = def.componentsDescription ?? def.components?.description;
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const parts: string[] = [];
  if (def.requiresVerbalComponent || def.components?.verbal) parts.push('V');
  if (def.requiresSomaticComponent || def.components?.somatic) parts.push('S');
  if (def.requiresMaterialComponent || def.components?.material) {
    const mat = def.componentsDescription ?? def.materialComponentDescription ?? '';
    parts.push(typeof mat === 'string' && mat.trim() && !/^[VSM, ]+$/i.test(mat) ? `M (${mat.trim()})` : 'M');
  }
  return parts.length ? parts.join(', ') : undefined;
}

function formatSpellDuration(def: any, concentration: boolean): string | undefined {
  const direct = def.durationDescription ?? def.duration?.description;
  if (typeof direct === 'string' && direct.trim()) {
    const text = direct.trim();
    if (concentration && !/concentration/i.test(text)) return `Concentration, ${text}`;
    return text;
  }
  const dur = def.duration ?? {};
  const type = Number(dur.durationType);
  if (type === 2 || /instant/i.test(String(dur.durationUnit ?? ''))) {
    return concentration ? 'Concentration' : 'Instantaneous';
  }
  const n = Number(dur.durationInterval ?? dur.durationAmount ?? 1) || 1;
  const unit = DDB_DURATION_UNIT[Number(dur.durationUnit)] ?? '';
  if (!unit) return concentration ? 'Concentration' : undefined;
  const span = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return concentration ? `Concentration, up to ${span}` : span;
}

function addSpellSlot(out: GrimoireSpellSlots[], level: number, total: number, used: number): void {
  if (!Number.isFinite(level) || level < 1 || level > 9) return;
  if (!Number.isFinite(total) || total <= 0) return;
  const spent = Number.isFinite(used) ? Math.max(0, Math.min(total, used)) : 0;
  const existing = out.find((s) => s.level === level);
  if (existing) {
    existing.total = Math.max(existing.total, total);
    existing.used = Math.max(existing.used, spent);
    return;
  }
  out.push({ level, total, used: spent });
}

function ingestSpellSlotPool(out: GrimoireSpellSlots[], slots: unknown): void {
  if (!slots) return;
  if (Array.isArray(slots)) {
    slots.forEach((s, i) => {
      if (!s || typeof s !== 'object') return;
      const row = s as Record<string, unknown>;
      const level = Number(row.level ?? i);
      const total = Number(row.max ?? row.total ?? row.available ?? 0);
      const used = Number(row.used ?? row.numberUsed ?? 0);
      addSpellSlot(out, level, total, used);
    });
    return;
  }
  if (typeof slots !== 'object') return;
  for (const [key, s] of Object.entries(slots as Record<string, unknown>)) {
    if (!s || typeof s !== 'object') continue;
    const row = s as Record<string, unknown>;
    const fromKey = Number(String(key).replace(/\D/g, '') || key);
    const level = Number(row.level ?? fromKey);
    const total = Number(row.max ?? row.total ?? row.available ?? 0);
    const used = Number(row.used ?? row.numberUsed ?? 0);
    addSpellSlot(out, level, total, used);
  }
}

function parseSpellSlots(raw: any): GrimoireSpellSlots[] {
  const out: GrimoireSpellSlots[] = [];
  ingestSpellSlotPool(out, raw.spellSlots);
  ingestSpellSlotPool(out, raw.slots);
  ingestSpellSlotPool(out, raw.pactMagic);
  for (const cls of raw.classes ?? []) {
    ingestSpellSlotPool(out, cls?.spellSlots);
    ingestSpellSlotPool(out, cls?.pactMagic);
  }
  return out.sort((a, b) => a.level - b.level);
}

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
  const knownCaster = classes.some((c: string) => /bard|sorcerer|warlock/i.test(c));

  const attacks = extractAllAttacks(raw, abilities);
  const featureCtx = { abilities, proficiencyBonus };
  const features: GrimoireFeature[] = [];

  for (const row of raw.classFeatures ?? raw.features?.class ?? []) {
    const feature = normalizeDdbFeature(row, `class-${row?.id ?? row?.definition?.name}`, featureCtx);
    if (feature) mergeFeature(features, feature);
  }

  for (const [source, list] of [
    ['class', raw.actions?.class ?? []],
    ['race', raw.actions?.race ?? []],
    ['feat', raw.actions?.feat ?? []],
  ] as const) {
    for (const action of list) {
      if (isWeaponAttackEntry(action, source)) continue;
      const feature = normalizeDdbFeature(action, `${source}-${action.id ?? action.name}`, featureCtx);
      if (feature) mergeFeature(features, feature);
    }
  }

  const spells: GrimoireSpell[] = [];
  const seenSpells = new Set<string>();
  for (const entry of collectSpellEntries(raw)) {
    const def = entry.definition ?? entry.spellDefinition ?? entry;
    if (!def?.name) continue;
    const level = Number(def.level ?? entry.level ?? 0) || 0;
    const key = `${String(def.name).toLowerCase()}|${level}`;
    if (seenSpells.has(key)) continue;
    seenSpells.add(key);
    const dice = normalizeDiceNotation(def.damage);
    const alwaysPrepared = Boolean(entry.alwaysPrepared || def.alwaysPrepared);
    const prepared = Boolean(entry.prepared || alwaysPrepared || level === 0 || knownCaster);
    const higher = stripDdbHtml(def.atHigherLevels ?? def.higherLevelDescription ?? '');
    const description = [
      stripDdbHtml(def.description ?? def.snippet ?? ''),
      higher ? `At Higher Levels.\n${higher}` : '',
    ].filter(Boolean).join('\n\n');
    const school = formatSpellSchool(def);
    const castingTime = formatSpellCastingTime(def);
    const rangeText = formatSpellRangeText(def);
    const components = formatSpellComponents(def);
    const concentration = Boolean(def.concentration);
    const durationText = formatSpellDuration(def, concentration);
    spells.push({
      id: String(def.id ?? entry.id ?? def.name),
      name: def.name,
      level,
      ...(school ? { school } : {}),
      ...(dice ? { damage: dice } : {}),
      damageType: def.damageType ?? def.damageTypeName,
      save: def.saveDcAbilityId ? abilityName(def.saveDcAbilityId) : undefined,
      attack: Boolean(def.attackType || def.requiresAttackRoll),
      aoe: parseAoe(def),
      prepared,
      ritual: def.ritual ?? false,
      concentration,
      ...(alwaysPrepared ? { alwaysPrepared: true } : {}),
      ...(description ? { description } : {}),
      ...(castingTime ? { castingTime } : {}),
      ...(rangeText ? { rangeText } : {}),
      ...(components ? { components } : {}),
      ...(durationText ? { durationText } : {}),
    });
  }

  const spellSlots = parseSpellSlots(raw);

  const inventory: GrimoireInventoryItem[] = (raw.inventory ?? []).map((item: any) =>
    normalizeInventoryItem(item),
  );

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
