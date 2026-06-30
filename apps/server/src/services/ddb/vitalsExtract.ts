/* eslint-disable @typescript-eslint/no-explicit-any */
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
  return false;
}

function collectActiveModifiers(raw: any): any[] {
  return collectModifiers(raw).filter((mod) => isModifierActive(raw, mod));
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

function collectHitPointModifiers(raw: any): any[] {
  const list = [...collectActiveModifiers(raw)];

  for (const item of raw.inventory ?? []) {
    if (!isItemActive(item)) continue;
    const granted = item.definition?.grantedModifiers ?? item.grantedModifiers ?? [];
    if (Array.isArray(granted)) list.push(...granted);
  }

  for (const feat of raw.feats ?? []) {
    const def = feat.definition ?? {};
    for (const key of ['modifiers', 'grantedModifiers']) {
      const mods = def[key];
      if (Array.isArray(mods)) list.push(...mods);
    }
  }

  return list;
}

function sumHitPointBonusesFromModifiers(raw: any): number {
  const level = characterLevel(raw);
  let sum = 0;

  for (const m of collectHitPointModifiers(raw)) {
    if (!isHitPointModifier(m)) continue;
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
    raw.hitPointInfo?.maximum,
    raw.hitPointInfo?.max,
    raw.hitPointsInfo?.maximum,
  );
}

function computeMaxHitPoints(raw: any): number {
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
  const extraBonus = Math.max(fromModifiers, fromFeats);
  const bonus = (bonusField ?? conBonus) + extraBonus;

  let maxHp = base > 0
    ? Math.floor(base + bonus)
    : base + bonus;

  const override = pickNumber(raw.overrideHitPoints, raw.hitPointInfo?.override);
  if (override != null && override > 0) maxHp = override;

  const adjusted = pickNumber(
    raw.adjustedHitPoints,
    raw.hitPointInfo?.adjusted,
    raw.hitPointsInfo?.adjusted,
  );
  if (adjusted != null && adjusted > maxHp) maxHp = adjusted;

  // DDB often omits a top-level max — use sheet max only when it exceeds our computed total.
  const sheetMax = pickSheetMaxHp(raw);
  if (sheetMax != null && sheetMax > maxHp) maxHp = sheetMax;

  return Math.max(maxHp, 1);
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

function inventoryHasBodyArmor(raw: any): boolean {
  return (raw.inventory ?? []).some((item: any) => {
    if (!isItemActive(item)) return false;
    const def = item.definition ?? {};
    const filterType = String(def.filterType ?? def.type ?? '').toLowerCase();
    if (!filterType.includes('armor')) return false;
    const armorTypeId = Number(def.armorTypeId ?? 0);
    const baseName = String(def.baseArmorName ?? def.name ?? '').toLowerCase();
    return !baseName.includes('shield') && armorTypeId !== 4;
  });
}

function sumModifierBonus(mods: any[], subType: string): number {
  return mods.reduce((sum, mod) => {
    if (String(mod.type ?? '').toLowerCase() !== 'bonus') return sum;
    if (normalizeSubType(mod) !== subType) return sum;
    const val = pickNumber(mod.value, mod.fixedValue) ?? 0;
    return Number.isFinite(val) ? sum + val : sum;
  }, 0);
}

function extractAcFromEquipment(raw: any, dexMod: number): number {
  let bodyAc = 0;
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
      continue;
    }

    let dexAdd = dexMod;
    if (armorTypeId === 3) dexAdd = 0;
    else if (armorTypeId === 2) dexAdd = Math.min(Math.max(dexMod, 0), 2);

    bodyAc = Math.max(bodyAc, ac + Math.max(0, dexAdd));
  }

  if (bodyAc === 0) return 0;

  const armoredBonus = sumModifierBonus(collectActiveModifiers(raw), 'armored-armor-class');
  return bodyAc + shieldBonus + armoredBonus;
}

function computeUnarmoredAc(raw: any, dexMod: number, mods: any[]): number {
  const ignoreDex = mods.some(
    (mod) => String(mod.type ?? '').toLowerCase() === 'ignore'
      && normalizeSubType(mod) === 'unarmored-dex-ac-bonus',
  );

  let maxDex = dexMod;
  for (const mod of mods) {
    if (String(mod.type ?? '').toLowerCase() !== 'set') continue;
    if (normalizeSubType(mod) !== 'ac-max-dex-modifier') continue;
    const cap = pickNumber(mod.value, mod.fixedValue);
    if (cap != null) maxDex = Math.min(maxDex, cap);
  }

  const setUnarmored = mods.find(
    (mod) => String(mod.type ?? '').toLowerCase() === 'set'
      && normalizeSubType(mod) === 'unarmored-armor-class',
  );
  const unarmoredBonus = sumModifierBonus(mods, 'unarmored-armor-class');

  const minimumBase = mods.find(
    (mod) => String(mod.type ?? '').toLowerCase() === 'set'
      && normalizeSubType(mod) === 'minimum-base-armor',
  );
  const base = minimumBase
    ? (pickNumber(minimumBase.value, minimumBase.fixedValue) ?? 10)
    : 10;

  const unarmoredBase = setUnarmored
    ? (pickNumber(setUnarmored.value, setUnarmored.fixedValue) ?? base)
    : base;

  const dexAdd = ignoreDex ? 0 : Math.max(0, maxDex);
  return unarmoredBase + dexAdd + unarmoredBonus;
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
  const abilities = extractAbilities(raw);
  const dexMod = abilities.find((a) => a.name === 'DEX')?.mod ?? 0;
  const mods = collectActiveModifiers(raw);
  const armored = inventoryHasBodyArmor(raw);

  let bonusAc = 0;
  for (const m of mods) {
    const sub = normalizeSubType(m);
    const type = String(m.type ?? '').toLowerCase();
    const val = pickNumber(m.value, m.fixedValue) ?? 0;
    if (!Number.isFinite(val) || val === 0) continue;
    if (type === 'bonus' && sub === 'armor-class') bonusAc += val;
  }

  const equippedAc = extractAcFromEquipment(raw, dexMod);
  const unarmored = computeUnarmoredAc(raw, dexMod, mods) + bonusAc;

  let computed = armored
    ? Math.max(equippedAc + bonusAc, unarmored)
    : Math.max(unarmored, 10 + dexMod + bonusAc);

  if (equippedAc > 0) computed = Math.max(computed, equippedAc + bonusAc);

  // Prefer computed AC; only trust a sheet value when it is higher (missed bonuses).
  const sheetAc = pickNumber(
    raw.armorClass,
    raw.ac,
    raw.hitPointInfo?.armorClass,
    raw.hitPointsInfo?.armorClass,
  );
  if (sheetAc != null && sheetAc > computed) computed = sheetAc;

  return Math.max(computed, 10);
}
