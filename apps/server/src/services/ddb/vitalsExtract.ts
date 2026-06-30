/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeAbilityName } from '@grimoire/shared';
import { collectModifiers, pickNumber } from './attackExtract';
import { extractAbilities } from './abilitiesExtract';

/** @deprecated Use DDB_NORMALIZER_VERSION from normalizerVersion.ts */
export { DDB_NORMALIZER_VERSION as HP_NORMALIZER_VERSION } from './normalizerVersion';

function characterLevel(raw: any): number {
  const classLevels = (raw.classes ?? []).reduce(
    (sum: number, c: any) => sum + (pickNumber(c.level) ?? 0),
    0,
  );
  return classLevels || pickNumber(raw.level) || 1;
}

function normalizeSubType(m: any): string {
  return String(m.subType ?? m.friendlySubtypeName ?? '')
    .toLowerCase()
    .replace(/\s+/g, '-');
}

function isItemActive(item: any): boolean {
  const def = item.definition ?? item;
  const equipped = item.equipped ?? false;
  const canEquip = def.canEquip ?? false;
  const canAttune = def.canAttune ?? item.canAttune ?? false;
  const attuned = item.isAttuned ?? false;
  const isConsumable = def.isConsumable ?? item.isConsumable ?? false;
  const filterType = String(def.filterType ?? def.type ?? '').toLowerCase();

  if (isConsumable || filterType.includes('potion')) return false;
  if (canEquip && !equipped) return false;
  if (canAttune && !attuned) return false;
  return true;
}

/** Item-linked modifiers apply only when the item is equipped (and attuned if required). */
function isModifierActive(raw: any, mod: any): boolean {
  const componentId = mod.componentId ?? mod.componentID;
  if (componentId == null || componentId === '') return true;
  for (const item of raw.inventory ?? []) {
    const defId = item.definition?.id ?? item.definitionId;
    if (defId !== componentId) continue;
    return isItemActive(item);
  }
  // componentId refers to a class feature, racial trait, etc. — not an inventory row.
  return true;
}

function collectActiveModifiers(raw: any): any[] {
  return collectModifiers(raw).filter((mod) => isModifierActive(raw, mod));
}

function isHealingHitPointModifier(m: any): boolean {
  const sub = normalizeSubType(m);
  if (sub.includes('temporary-hit-point')) return true;
  const dice = m.dice ?? m.die;
  if (dice?.diceCount != null || dice?.diceValue != null) return true;
  return false;
}

function isHitPointModifier(m: any): boolean {
  const sub = normalizeSubType(m);
  const friendly = String(m.friendlySubtypeName ?? m.friendlyTypeName ?? '').toLowerCase();
  const type = String(m.type ?? '').toLowerCase();

  if (type === 'set' && (sub.includes('hit-point') || sub.includes('hitpoint') || friendly.includes('hit point'))) {
    return true;
  }

  return (
    sub.includes('hit-point')
    || sub.includes('hitpoint')
    || sub === 'hp'
    || sub.includes('bonus-hit-point')
    || sub.includes('maximum-hit-point')
    || /hit[\s-]?point|tough|health/.test(friendly)
  );
}

function isPerLevelHitPointModifier(m: any): boolean {
  const sub = normalizeSubType(m);
  const friendly = String(m.friendlySubtypeName ?? '').toLowerCase();
  return (
    sub.includes('per-level')
    || friendly.includes('per level')
    || sub === 'hit-points-per-level'
    || sub === 'hit-point-per-level'
  );
}

function modifierHitPointValue(m: any, level: number): number {
  const val = pickNumber(m.value, m.fixedValue) ?? 0;
  if (!Number.isFinite(val) || val === 0) return 0;

  const type = String(m.type ?? '').toLowerCase();
  if (type !== 'bonus' && type !== 'maximum' && type !== 'set') return 0;

  if (isPerLevelHitPointModifier(m)) return val * level;
  return val;
}

function appendDefinitionModifiers(list: any[], source: any): void {
  const def = source?.definition ?? source;
  if (!def) return;
  for (const key of ['modifiers', 'grantedModifiers']) {
    const mods = def[key];
    if (Array.isArray(mods)) list.push(...mods);
  }
}

function collectFeatureModifiers(raw: any): any[] {
  const list: any[] = [];

  for (const cls of raw.classes ?? []) {
    appendDefinitionModifiers(list, cls);
    for (const feature of cls.classFeatures ?? cls.definition?.classFeatures ?? []) {
      appendDefinitionModifiers(list, feature);
    }
  }

  for (const trait of raw.race?.racialTraits ?? raw.race?.definition?.racialTraits ?? []) {
    appendDefinitionModifiers(list, trait);
  }

  appendDefinitionModifiers(list, raw.background);
  appendDefinitionModifiers(list, raw.background?.definition);

  for (const bucket of Object.values(raw.options ?? {})) {
    if (!Array.isArray(bucket)) continue;
    for (const opt of bucket) appendDefinitionModifiers(list, opt);
  }

  return list;
}

function collectConditionModifiers(raw: any): any[] {
  const condition = raw.modifiers?.condition;
  return Array.isArray(condition) ? condition : [];
}

function modifierKey(m: any): string {
  if (m.id != null && m.id !== '') return String(m.id);
  return `${m.componentId}:${m.componentTypeId}:${m.type}:${m.subType}`;
}

function appendUniqueModifiers(list: any[], mods: any[]): void {
  const seen = new Set(list.map(modifierKey));
  for (const mod of mods) {
    const key = modifierKey(mod);
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(mod);
  }
}

function collectHitPointModifiers(raw: any): any[] {
  const list = [
    ...collectActiveModifiers(raw),
    ...collectFeatureModifiers(raw),
    ...collectConditionModifiers(raw),
  ];

  for (const item of raw.inventory ?? []) {
    if (!isItemActive(item)) continue;
    const granted = item.definition?.grantedModifiers ?? item.grantedModifiers ?? [];
    if (Array.isArray(granted)) appendUniqueModifiers(list, granted);
  }

  for (const feat of raw.feats ?? []) {
    const def = feat.definition ?? {};
    for (const key of ['modifiers', 'grantedModifiers']) {
      const mods = def[key];
      if (Array.isArray(mods)) appendUniqueModifiers(list, mods);
    }
  }

  return list;
}

function sumHitPointBonusesFromModifiers(raw: any): number {
  const level = characterLevel(raw);
  let sum = 0;

  for (const m of collectHitPointModifiers(raw)) {
    if (!isHitPointModifier(m)) continue;
    if (isHealingHitPointModifier(m)) continue;
    if (String(m.type ?? '').toLowerCase() === 'set') continue;
    sum += modifierHitPointValue(m, level);
  }

  return sum;
}

function sumFeatHitPointBonus(raw: any): number {
  let sum = 0;
  const level = characterLevel(raw);

  for (const feat of raw.feats ?? []) {
    const name = String(feat.definition?.name ?? feat.name ?? '').toLowerCase();
    if (/\btough\b/.test(name)) sum += level * 2;
  }

  return sum;
}

function constitutionHitPointBonus(raw: any): number {
  const abilities = extractAbilities(raw);
  const conMod = abilities.find((a) => a.name === 'CON')?.mod ?? 0;
  return Math.max(0, conMod * characterLevel(raw));
}

function pickSheetMaxHp(raw: any): number | undefined {
  return pickNumber(
    raw.maximumHitPoints,
    raw.maxHitPoints,
    raw.maxHp,
    raw.hitPointInfo?.maximum,
    raw.hitPointInfo?.max,
    raw.hitPointsInfo?.maximum,
  );
}

function applyHpOverrides(raw: any, maxHp: number): number {
  let result = maxHp;

  const override = pickNumber(raw.overrideHitPoints, raw.hitPointInfo?.override);
  if (override != null && override > 0) result = override;

  const adjusted = pickNumber(
    raw.adjustedHitPoints,
    raw.hitPointInfo?.adjusted,
    raw.hitPointsInfo?.adjusted,
  );
  if (adjusted != null && adjusted > result) result = adjusted;

  return Math.max(result, 1);
}

function computeMaxHitPoints(raw: any): number {
  const sheetMax = pickSheetMaxHp(raw);
  if (sheetMax != null && sheetMax > 0) {
    return applyHpOverrides(raw, sheetMax);
  }

  const base =
    pickNumber(
      raw.baseHitPoints,
      raw.baseHitPointTotal,
      raw.hitPointInfo?.base,
      raw.hitPointsInfo?.base,
      raw.hitPointInfo?.baseHitPoints,
    ) ?? 0;

  const bonusField = pickNumber(
    raw.bonusHitPoints,
    raw.bonusHitPointTotal,
    raw.hitPointInfo?.bonus,
    raw.hitPointsInfo?.bonus,
    raw.hitPointInfo?.bonusHitPoints,
  );

  const conBonus = constitutionHitPointBonus(raw);
  const fromModifiers = sumHitPointBonusesFromModifiers(raw);
  const fromFeats = sumFeatHitPointBonus(raw);
  const hasToughModifier = collectHitPointModifiers(raw).some((m) => {
    if (!isHitPointModifier(m)) return false;
    const friendly = String(m.friendlySubtypeName ?? '').toLowerCase();
    const isPerLevel = isPerLevelHitPointModifier(m)
      && modifierHitPointValue(m, characterLevel(raw)) >= characterLevel(raw) * 2;
    return friendly.includes('tough') || isPerLevel;
  });
  const extraBonus = fromModifiers + (hasToughModifier ? 0 : fromFeats);
  // When DDB sends bonusHitPoints it already includes CON×level and feat bonuses.
  const bonus = bonusField != null ? bonusField : conBonus + extraBonus;

  const maxHp = base > 0 ? Math.floor(base + bonus) : base + bonus;
  return applyHpOverrides(raw, maxHp);
}

function computeCurrentHitPoints(raw: any, maxHp: number): number {
  const removed =
    pickNumber(
      raw.removedHitPoints,
      raw.damageTaken,
      raw.hitPointInfo?.removed,
      raw.hitPointsInfo?.removed,
    ) ?? 0;

  const explicit = pickNumber(
    raw.currentHitPoints,
    raw.currentHp,
    raw.remainingHitPoints,
    raw.hitPointInfo?.current,
    raw.hitPointInfo?.remaining,
    raw.hitPointsInfo?.current,
  );

  if (explicit != null) {
    return Math.max(0, Math.min(explicit, maxHp));
  }

  if (maxHp > 0) {
    return Math.max(0, maxHp - removed);
  }

  return Math.max(0, pickNumber(raw.hitPoints, raw.hp) ?? 0);
}

function collectAcModifiers(raw: any): any[] {
  const list = [
    ...collectActiveModifiers(raw),
    ...collectFeatureModifiers(raw),
    ...collectConditionModifiers(raw),
  ];

  for (const item of raw.inventory ?? []) {
    if (!isItemActive(item)) continue;
    const granted = item.definition?.grantedModifiers ?? item.grantedModifiers ?? [];
    if (Array.isArray(granted)) appendUniqueModifiers(list, granted);
  }

  for (const feat of raw.feats ?? []) {
    const def = feat.definition ?? {};
    for (const key of ['modifiers', 'grantedModifiers']) {
      const mods = def[key];
      if (Array.isArray(mods)) appendUniqueModifiers(list, mods);
    }
  }

  return list;
}

function abilityModFromStatId(raw: any, statId: unknown): number {
  if (statId == null || statId === '') return 0;
  const name = normalizeAbilityName(statId);
  return extractAbilities(raw).find((a) => a.name === name)?.mod ?? 0;
}

function modifierValue(mod: any): number {
  return pickNumber(mod.value, mod.fixedValue, mod.die?.fixedValue, mod.dice?.fixedValue) ?? 0;
}

function isAcRelatedModifier(mod: any): boolean {
  const sub = normalizeSubType(mod);
  const friendly = String(mod.friendlySubtypeName ?? mod.friendlyTypeName ?? '').toLowerCase();
  const type = String(mod.type ?? '').toLowerCase();
  if (type === 'armor-class') return true;
  return (
    sub.includes('armor-class')
    || sub.includes('armor class')
    || sub === 'unarmored-ac'
    || sub === 'ac'
    || sub.includes('ac-max-dex')
    || sub.includes('minimum-base-armor')
    || friendly.includes('armor class')
  );
}

function effectiveDexMod(raw: any, mods: any[], baseDexMod: number): number {
  const ignoreDex = mods.some(
    (mod) => String(mod.type ?? '').toLowerCase() === 'ignore'
      && normalizeSubType(mod) === 'unarmored-dex-ac-bonus',
  );
  if (ignoreDex) return 0;

  let dexMod = Math.max(0, baseDexMod);
  for (const mod of mods) {
    if (String(mod.type ?? '').toLowerCase() !== 'set') continue;
    if (normalizeSubType(mod) !== 'ac-max-dex-modifier') continue;
    const cap = modifierValue(mod);
    if (Number.isFinite(cap)) dexMod = Math.min(dexMod, cap);
  }
  return dexMod;
}

function extractShieldBonus(raw: any): number {
  let shieldBonus = 0;
  for (const item of raw.inventory ?? []) {
    if (!isItemActive(item)) continue;
    const def = item.definition ?? {};
    const filterType = String(def.filterType ?? def.type ?? '').toLowerCase();
    if (!filterType.includes('armor')) continue;
    const ac = Number(def.armorClass ?? 0);
    if (!ac) continue;
    const baseName = String(def.baseArmorName ?? def.name ?? '').toLowerCase();
    const armorTypeId = Number(def.armorTypeId ?? 0);
    if (baseName.includes('shield') || armorTypeId === 4) {
      shieldBonus = Math.max(shieldBonus, ac);
    }
  }
  return shieldBonus;
}

function extractBodyArmorAc(raw: any, dexMod: number): number {
  let bodyAc = 0;

  for (const item of raw.inventory ?? []) {
    if (!isItemActive(item)) continue;
    const def = item.definition ?? {};
    const filterType = String(def.filterType ?? def.type ?? '').toLowerCase();
    if (!filterType.includes('armor')) continue;

    const ac = Number(def.armorClass ?? 0);
    if (!ac) continue;

    const baseName = String(def.baseArmorName ?? def.name ?? '').toLowerCase();
    const armorTypeId = Number(def.armorTypeId ?? 0);
    if (baseName.includes('shield') || armorTypeId === 4) continue;

    let dexAdd = dexMod;
    if (armorTypeId === 3) dexAdd = 0;
    else if (armorTypeId === 2) dexAdd = Math.min(Math.max(dexMod, 0), 2);

    bodyAc = Math.max(bodyAc, ac + Math.max(0, dexAdd));
  }

  return bodyAc;
}

function sumBonusBySubtypes(mods: any[], subtypes: string[]): number {
  const wanted = new Set(subtypes.map((s) => s.toLowerCase()));
  return mods.reduce((sum, mod) => {
    if (String(mod.type ?? '').toLowerCase() !== 'bonus') return sum;
    const sub = normalizeSubType(mod);
    if (!wanted.has(sub) && !subtypes.some((s) => sub.includes(s))) return sum;
    const val = modifierValue(mod);
    return Number.isFinite(val) ? sum + val : sum;
  }, 0);
}

function bonusAcValue(raw: any, mod: any): number {
  const val = modifierValue(mod);
  if (mod.statId != null && (mod.value == null || val === 0)) {
    return abilityModFromStatId(raw, mod.statId);
  }
  return Number.isFinite(val) ? val : 0;
}

/** DDB evaluates several AC formulas and uses the highest. */
function computeAcCandidates(raw: any): number[] {
  const abilities = extractAbilities(raw);
  const dexMod = abilities.find((a) => a.name === 'DEX')?.mod ?? 0;
  const mods = collectAcModifiers(raw);
  const dexAdd = effectiveDexMod(raw, mods, dexMod);
  const candidates: number[] = [];

  let miscAcBonus = 0;
  let unarmoredFlatBonus = 0;
  let unarmoredSetBonus = 0;
  let unarmoredAbilityBonus = 0;
  let setFlatAc = 0;
  let minimumBaseArmor = 0;

  for (const mod of mods) {
    if (!isAcRelatedModifier(mod)) continue;
    const sub = normalizeSubType(mod);
    const type = String(mod.type ?? '').toLowerCase();

    if (type === 'bonus') {
      const bonusVal = bonusAcValue(raw, mod);
      if (bonusVal === 0) continue;

      if (sub === 'armor-class' || sub === 'ac') {
        miscAcBonus += bonusVal;
      } else if (sub === 'unarmored-armor-class' || sub === 'unarmored-ac') {
        unarmoredFlatBonus += bonusVal;
        if (mod.statId != null) {
          unarmoredAbilityBonus += abilityModFromStatId(raw, mod.statId);
        }
      } else if (sub.includes('armor-class') || sub.includes('armor class')) {
        miscAcBonus += bonusVal;
      }
      continue;
    }

    const val = modifierValue(mod);
    if (!Number.isFinite(val)) continue;

    if (type !== 'set') continue;

    if (sub === 'unarmored-armor-class') {
      unarmoredSetBonus = Math.max(unarmoredSetBonus, val);
      if (mod.statId != null) {
        unarmoredAbilityBonus += abilityModFromStatId(raw, mod.statId);
      }
      continue;
    }

    if (sub === 'minimum-base-armor') {
      minimumBaseArmor = Math.max(minimumBaseArmor, val);
      continue;
    }

    if (sub === 'armor-class' || sub === 'ac') {
      setFlatAc = Math.max(setFlatAc, val);
    }
  }

  const shield = extractShieldBonus(raw);
  const armoredBody = extractBodyArmorAc(raw, dexAdd);
  const armoredBonus = sumBonusBySubtypes(mods, ['armored-armor-class']);

  // Standard 10 + DEX (+ shield stacks on top of whichever base wins).
  candidates.push(10 + dexAdd + miscAcBonus + shield);

  // Unarmored Defense / Draconic Resilience: base (usually 10) + DEX + ability (e.g. CON/WIS).
  if (unarmoredSetBonus > 0 || unarmoredAbilityBonus > 0 || unarmoredFlatBonus > 0) {
    const unarmoredBase = unarmoredSetBonus > 0 ? unarmoredSetBonus : 10;
    candidates.push(
      unarmoredBase + dexAdd + unarmoredAbilityBonus + unarmoredFlatBonus + miscAcBonus + shield,
    );
  }

  if (minimumBaseArmor > 0) {
    candidates.push(minimumBaseArmor + miscAcBonus + shield);
  }

  // Mage Armor and similar: set base (e.g. 13) + DEX.
  if (setFlatAc > 0) {
    candidates.push(setFlatAc + dexAdd + miscAcBonus + shield);
  }

  if (armoredBody > 0) {
    candidates.push(armoredBody + armoredBonus + miscAcBonus + shield);
  } else if (shield > 0) {
    // Shield without body armor still stacks on unarmored base.
    candidates.push(10 + dexAdd + shield + miscAcBonus + unarmoredFlatBonus);
  }

  return candidates;
}

export function extractVitals(raw: any): { hp: number; maxHp: number; tempHp: number } {
  const maxHp = computeMaxHitPoints(raw);
  const hp = computeCurrentHitPoints(raw, maxHp);
  const tempHp =
    pickNumber(
      raw.temporaryHitPoints,
      raw.tempHp,
      raw.hitPointInfo?.temporary,
      raw.hitPointInfo?.temp,
      raw.hitPointsInfo?.temporary,
    ) ?? 0;

  return {
    hp: Math.max(0, hp),
    maxHp: Math.max(maxHp, hp, 1),
    tempHp: Math.max(0, tempHp),
  };
}

export function extractAc(raw: any): number {
  const sheetAc = pickNumber(
    raw.armorClass,
    raw.ac,
    raw.hitPointInfo?.armorClass,
    raw.hitPointsInfo?.armorClass,
  );
  const computed = Math.max(...computeAcCandidates(raw), 10);

  if (sheetAc != null && sheetAc > 0) {
    return Math.max(sheetAc, computed);
  }

  return computed;
}
