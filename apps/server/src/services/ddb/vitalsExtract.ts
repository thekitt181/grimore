/* eslint-disable @typescript-eslint/no-explicit-any */
import { collectModifiers, pickNumber } from './attackExtract';
import { extractAbilities } from './abilitiesExtract';

/** @deprecated Use DDB_NORMALIZER_VERSION from normalizerVersion.ts */
export { DDB_NORMALIZER_VERSION as HP_NORMALIZER_VERSION } from './normalizerVersion';

/**
 * Recursively finds a numeric value in an object by key name (case-insensitive)
 */
function findNestedNumber(obj: any, ...keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  
  // Check current level
  for (const key of keys) {
    const lowerKey = key.toLowerCase();
    for (const [objKey, value] of Object.entries(obj)) {
      if (objKey.toLowerCase() === lowerKey && typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
    }
  }
  
  // Recurse into nested objects
  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      const found = findNestedNumber(value, ...keys);
      if (found !== undefined) return found;
    }
  }
  
  return undefined;
}

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
    || sub.includes('per-level')
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

/** Collect HP-related modifiers from every DDB source (global, items, feat defs). */
function collectHitPointModifiers(raw: any): any[] {
  const list = [...collectModifiers(raw)];

  for (const item of raw.inventory ?? []) {
    if (!item.equipped) continue;
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

function computeMaxHitPoints(raw: any): number {
  console.log('[computeMaxHitPoints] Raw top-level keys:', Object.keys(raw));
  console.log('[computeMaxHitPoints] Starting with raw:', raw);
  
  // Prioritize any sheet-provided max HP field first
  const sheetMax = findNestedNumber(
    raw,
    'maxHitPoints',
    'maxHp',
    'maximumHitPoints',
    'max'
  );
  console.log('[computeMaxHitPoints] sheetMax:', sheetMax);
  if (sheetMax !== undefined && sheetMax > 0) return sheetMax;

  const base =
    pickNumber(
      raw.baseHitPoints,
      raw.baseHitPointTotal,
      raw.hitPointInfo?.base,
      raw.hitPointsInfo?.base,
      raw.hitPointInfo?.baseHitPoints,
    ) ?? 0;
  console.log('[computeMaxHitPoints] base:', base);

  const bonusField = pickNumber(
    raw.bonusHitPoints,
    raw.bonusHitPointTotal,
    raw.hitPointInfo?.bonus,
    raw.hitPointsInfo?.bonus,
    raw.hitPointInfo?.bonusHitPoints,
  );
  console.log('[computeMaxHitPoints] bonusField:', bonusField);

  // DDB stores rolled/class HP in baseHitPoints; CON×level usually lives in bonusHitPoints
  // but that field is often null — compute from ability scores when missing.
  const conBonus = constitutionHitPointBonus(raw);
  console.log('[computeMaxHitPoints] conBonus:', conBonus);
  
  const fromModifiers = sumHitPointBonusesFromModifiers(raw);
  const fromFeats = sumFeatHitPointBonus(raw);
  console.log('[computeMaxHitPoints] fromModifiers:', fromModifiers, 'fromFeats:', fromFeats);
  
  const extraBonus = Math.max(fromModifiers, fromFeats);
  const bonus = (bonusField ?? conBonus) + extraBonus;
  console.log('[computeMaxHitPoints] bonus:', bonus);

  let maxHp = base + bonus;
  console.log('[computeMaxHitPoints] maxHp after base+bonus:', maxHp);

  const override = pickNumber(raw.overrideHitPoints, raw.hitPointInfo?.override);
  console.log('[computeMaxHitPoints] override:', override);
  if (override !== undefined && override > 0) maxHp = override;

  const adjusted = pickNumber(
    raw.adjustedHitPoints,
    raw.hitPointInfo?.adjusted,
    raw.hitPointsInfo?.adjusted,
  );
  console.log('[computeMaxHitPoints] adjusted:', adjusted);
  if (adjusted !== undefined && adjusted > maxHp) maxHp = adjusted;

  const result = Math.max(maxHp, 1);
  console.log('[computeMaxHitPoints] Final result:', result);
  return result;
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

function extractAcFromEquipment(raw: any, dexMod: number): number {
  let bodyAc = 0;
  let shieldBonus = 0;

  for (const item of raw.inventory ?? []) {
    if (!item.equipped) continue;
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

  return bodyAc > 0 ? bodyAc + shieldBonus : 0;
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
  console.log('[extractAc] Raw top-level keys:', Object.keys(raw));
  console.log('[extractAc] Starting with raw:', raw);
  
  // Prioritize any sheet-provided AC field first
  const sheetAc = findNestedNumber(
    raw,
    'armorClass',
    'ac'
  );
  console.log('[extractAc] sheetAc:', sheetAc);
  if (sheetAc !== undefined && sheetAc > 0) return sheetAc;

  const abilities = extractAbilities(raw);
  const dexMod = abilities.find((a) => a.name === 'DEX')?.mod ?? 0;
  console.log('[extractAc] dexMod:', dexMod);

  let setAc = 0;
  let bonusAc = 0;

  for (const m of collectModifiers(raw)) {
    const sub = String(m.subType ?? m.friendlySubtypeName ?? '').toLowerCase();
    const friendly = String(m.friendlyTypeName ?? m.friendlySubtypeName ?? '').toLowerCase();
    const type = String(m.type ?? '').toLowerCase();
    const val = Number(m.value ?? m.fixedValue ?? 0);
    if (!Number.isFinite(val)) continue;

    const isAc =
      type === 'armor-class'
      || sub.includes('armor-class')
      || sub.includes('unarmored-armor-class')
      || sub === 'ac'
      || sub.includes('armor class')
      || friendly.includes('armor class');

    if (type === 'set' && isAc) {
      console.log('[extractAc] Found set modifier:', { m, val });
      setAc = Math.max(setAc, val);
    }
    if (type === 'bonus' && isAc) {
      console.log('[extractAc] Found bonus modifier:', { m, val });
      bonusAc += val;
    }
  }
  console.log('[extractAc] setAc:', setAc, 'bonusAc:', bonusAc);

  const equippedAc = extractAcFromEquipment(raw, dexMod);
  const unarmored = 10 + dexMod + bonusAc;
  console.log('[extractAc] equippedAc:', equippedAc, 'unarmored:', unarmored);

  if (setAc > 0) {
    const result = Math.max(setAc + bonusAc, equippedAc, unarmored);
    console.log('[extractAc] Final result (setAc path):', result);
    return result;
  }
  if (equippedAc > 0) {
    const result = Math.max(equippedAc + bonusAc, unarmored);
    console.log('[extractAc] Final result (equipped path):', result);
    return result;
  }
  console.log('[extractAc] Final result (unarmored):', unarmored);
  return Math.max(unarmored, 10);
}
