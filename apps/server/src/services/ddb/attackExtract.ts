/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizeAbilityName, normalizeDiceNotation, type GrimoireAbility, type GrimoireAttack } from '@grimoire/shared';

export function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function collectModifiers(raw: any): any[] {
  const m = raw.modifiers;
  if (!m) return [];
  if (Array.isArray(m)) return m;

  const out: any[] = [];
  for (const key of Object.keys(m)) {
    const val = m[key];
    if (Array.isArray(val)) out.push(...val);
  }
  return out;
}

export function extractActionDamage(action: any): string {
  const def = action.definition ?? {};
  const dice = normalizeDiceNotation(
    action.dice
    ?? action.damage
    ?? action.damageDice
    ?? action.damageInformation
    ?? action.fixedDamage
    ?? def.damage
    ?? def.fixedDamage
    ?? def.dice
    ?? action.attackDefinition?.damageDice
    ?? action.weaponBehaviors?.[0]?.damage
    ?? action.attack?.damage
    ?? action.attack?.dice,
  );
  if (dice) return dice;

  const additional = def.additionalDamages ?? action.additionalDamages ?? [];
  if (Array.isArray(additional)) {
    for (const entry of additional) {
      const d = normalizeDiceNotation(entry?.dice ?? entry?.damage ?? entry);
      if (d) return d;
    }
  }

  const behaviors = action.weaponBehaviors ?? def.weaponBehaviors ?? [];
  for (const b of behaviors) {
    const d = normalizeDiceNotation(b.damage ?? b.dice);
    if (d) return d;
  }

  return inferDefaultWeaponDice(String(action.name ?? def.name ?? '')) ?? '';
}

function isItemEquipped(item: any): boolean {
  return item?.equipped === true || item?.equipped === 1;
}

function itemFilterType(def: any, item?: any): string {
  return String(def.filterType ?? item?.filterType ?? '').toLowerCase();
}

/** Fallback dice when DDB omits damage on magic/custom weapons. */
function inferDefaultWeaponDice(name: string): string | undefined {
  const n = name.toLowerCase();
  if (/trident|halberd|glaive|pike/.test(n)) return '1d10';
  if (/longsword|warhammer|battleaxe|morningstar|rapier|scimitar|shortsword|whip|trident/.test(n)) return '1d8';
  if (/spear|handaxe|mace|quarterstaff|light hammer|javelin|sickle/.test(n)) return '1d6';
  if (/dagger|shortbow|hand crossbow|club/.test(n)) return '1d4';
  if (/longbow|heavy crossbow|greatclub|maul|greatsword|greataxe/.test(n)) return /longbow|heavy crossbow/.test(n) ? '1d8' : '2d6';
  if (/unarmed|fist|kick|punch|headbutt|knee|elbow|slam|claw|bite/.test(n)) return '1';
  return undefined;
}

function magicBonusFromItem(itemOrAction: any): number {
  const def = itemOrAction.definition ?? itemOrAction;
  const granted = [
    ...(def.grantedModifiers ?? []),
    ...(itemOrAction.grantedModifiers ?? []),
  ];
  let bonus = 0;
  for (const m of granted) {
    if (String(m.type ?? '').toLowerCase() !== 'bonus') continue;
    const sub = String(m.subType ?? m.friendlySubtypeName ?? '').toLowerCase();
    if (sub === 'magic' || sub.includes('magic')) {
      bonus += pickNumber(m.value, m.fixedValue) ?? 0;
    }
  }
  return bonus;
}

function inferAttackAbility(action: any, abilities: GrimoireAbility[]): number {
  const statId = pickNumber(action.attackStatId, action.abilityId, action.statId);
  if (statId != null) {
    const name = normalizeAbilityName(statId);
    return abilities.find((a) => a.name === name)?.mod ?? 0;
  }

  const name = String(action.name ?? action.definition?.name ?? '').toLowerCase();
  const str = abilities.find((a) => a.name === 'STR')?.mod ?? 0;
  const dex = abilities.find((a) => a.name === 'DEX')?.mod ?? 0;

  if (/bow|crossbow|sling|firearm|gun|ranged|javelin|dart|thrown/i.test(name)) return dex;
  if (/finesse|dagger|rapier|scimitar|shortsword|whip|hand crossbow/i.test(name)) return Math.max(str, dex);
  if (/unarmed|grapple|shove/i.test(name)) return str;
  return str;
}

export function extractActionToHit(action: any, raw: any, abilities: GrimoireAbility[]): number {
  const direct = pickNumber(
    action.attackModifier,
    action.attackBonus,
    action.toHit,
    action.attackMod,
    action.fixedToHit,
    action.definition?.attackModifier,
    action.attackAction?.attackModifier,
    action.attackData?.attackModifier,
    action.attack?.attackModifier,
    action.attack?.toHit,
  );
  if (direct != null && direct !== 0) return direct;

  const abilityMod = pickNumber(
    action.abilityModifier,
    action.statModifier,
    action.attackStatModifier,
    action.attackAction?.abilityModifier,
  );
  const prof =
    pickNumber(
      action.proficiencyBonus,
      action.attackAction?.proficiencyBonus,
      raw.proficiencyBonus,
    ) ?? proficiencyBonusFromRaw(raw);

  if (abilityMod != null) return abilityMod + prof + magicBonusFromItem(action);

  return inferAttackAbility(action, abilities) + prof + magicBonusFromItem(action);
}

function proficiencyBonusFromRaw(raw: any): number {
  const direct = pickNumber(raw.proficiencyBonus, raw.profBonus);
  if (direct != null) return direct;
  const classLevels = (raw.classes ?? []).reduce(
    (sum: number, c: any) => sum + (pickNumber(c.level) ?? 0),
    0,
  );
  const level = classLevels || pickNumber(raw.level) || 1;
  return Math.floor((level - 1) / 4) + 2;
}

function isWeaponLike(action: any): boolean {
  const def = action.definition ?? {};
  const filterType = String(def.filterType ?? action.filterType ?? '').toLowerCase();
  const type = String(def.type ?? action.type ?? '').toLowerCase();
  if (filterType.includes('weapon')) return true;
  if (type.includes('weapon')) return true;
  if (def.categoryId === 1 || action.categoryId === 1) return true;
  if (def.attackType != null || action.attackType != null) return true;
  if (extractActionDamage(action)) return true;
  return false;
}

function hasAttackRange(action: any): boolean {
  const range = action.range;
  if (range == null) return false;
  if (typeof range === 'number' || typeof range === 'string') return true;
  return pickNumber(range.range, range.reach, range.rangeValue, range.aoeSize) != null;
}
function isClassFeatureAction(name: string): boolean {
  return /maneuver|second wind|action surge|tactical mind|tactical shift|know your enemy|friend of the sea|superiority dice|primeval awareness|favored foe|extra attack|banishing arrow|piercing arrow|seeking arrow|curving shot|ever-ready shot|magic arrow|arcane shot/i.test(
    name,
  );
}

function inventoryItemIsWeapon(item: any): boolean {
  const def = item.definition ?? {};
  const filterType = itemFilterType(def, item);
  if (filterType.includes('weapon')) return true;
  if (def.categoryId === 1) return true;
  if (def.attackType != null) return true;

  const type = String(def.type ?? '').toLowerCase();
  if (/ammunition|gear|potion|scroll|armor|shield|wondrous|tool|pack|kit|adventuring/.test(type)) {
    return false;
  }

  if (extractActionDamage({ definition: def, damage: def.damage, name: def.name })) return true;
  if (def.damage != null && def.canEquip !== false) return true;

  const tags: string[] = def.tags ?? [];
  if (def.canEquip !== false && tags.includes('Damage') && tags.includes('Combat')) return true;

  return Boolean(inferDefaultWeaponDice(String(def.name ?? item.name ?? '')));
}

export function isWeaponAttackEntry(action: any, source: string): boolean {
  const name = String(action?.name ?? action?.definition?.name ?? '').toLowerCase();
  if (!name || isClassFeatureAction(name)) return false;

  if (source === 'custom') return true;

  if (source === 'item') return isWeaponLike(action);

  if (action.attackAction || action.isAttackAction || action.attackType != null) return true;
  if (action.weaponType || action.weaponName || action.weaponId) return true;
  if (action.displayAsAttack && (extractActionDamage(action) || pickNumber(action.fixedToHit) != null)) {
    return true;
  }

  const toHit = pickNumber(action.attackModifier, action.toHit, action.fixedToHit);
  if (toHit != null && toHit !== 0) return true;

  if (/attack|shoot|strike|slash|stab|bow|crossbow|sword|axe|spear|unarmed|bite|claw|slam|sap|trident|javelin|dagger|rapier|scimitar|mace|hammer|axe|whip|handaxe|longbow|shortbow/i.test(name)) {
    return true;
  }

  const dice = extractActionDamage(action);
  return Boolean(dice && hasAttackRange(action));
}

function weaponHintFromActionName(name: string): string | undefined {
  const paren = name.match(/\(([^)]+)\)/);
  if (paren?.[1]) return paren[1].trim();
  const dash = name.match(/[—–-]\s*(.+)$/);
  if (dash?.[1]) return dash[1].trim();
  return undefined;
}

function findInventoryWeapon(raw: any, hint?: string, entityId?: number): any | null {
  const inventory = raw.inventory ?? [];
  const hintLower = hint?.toLowerCase();

  for (const item of inventory) {
    if (!isItemEquipped(item)) continue;
    if (!inventoryItemIsWeapon(item)) continue;

    if (entityId != null && Number(item.id ?? item.definitionId) === entityId) return item;

    if (!hintLower) continue;
    const def = item.definition ?? {};
    const name = String(def.name ?? item.name ?? '').toLowerCase();
    if (name === hintLower || name.includes(hintLower) || hintLower.includes(name)) return item;
  }
  return null;
}

function mergeWeaponItem(action: any, item: any): any {
  const def = item.definition ?? {};
  return {
    ...action,
    definition: { ...def, ...(action.definition ?? {}) },
    weaponBehaviors: action.weaponBehaviors ?? def.weaponBehaviors ?? item.weaponBehaviors,
    damage: action.damage ?? def.damage ?? item.damage ?? def.dice,
    dice: action.dice ?? def.damage ?? def.dice,
    longRange: action.longRange ?? def.longRange ?? item.longRange,
    attackModifier:
      action.attackModifier
      ?? item.attackBonus
      ?? item.attackModifier
      ?? item.attackRoll,
    damageTypeName: action.damageTypeName ?? def.damageTypeName ?? item.damageTypeName,
    range: action.range ?? def.range ?? def.weaponType,
  };
}

function weaponPropertyNames(def: any): string[] {
  return (def.properties ?? [])
    .map((p: any) => String(p.name ?? '').trim())
    .filter(Boolean);
}

function versatileDamageDice(def: any): string | undefined {
  for (const p of def.properties ?? []) {
    if (String(p.name ?? '').toLowerCase() !== 'versatile') continue;
    const fromNotes = normalizeDiceNotation(p.notes);
    if (fromNotes) return fromNotes;
  }
  return undefined;
}

function extractBonusDamages(def: any): { dice: string; type: string; label?: string }[] {
  const out: { dice: string; type: string; label?: string }[] = [];
  const defaultType = String(def.damageType ?? def.damageTypeName ?? 'damage');

  for (const entry of def.additionalDamages ?? []) {
    const dice = normalizeDiceNotation(entry?.dice ?? entry?.damage ?? entry);
    if (!dice) continue;
    out.push({
      dice,
      type: String(entry.damageType ?? entry.type ?? defaultType),
      label: entry.label ? String(entry.label) : undefined,
    });
  }

  for (const m of def.grantedModifiers ?? []) {
    if (String(m.type ?? '').toLowerCase() !== 'damage') continue;
    const dice = normalizeDiceNotation(m.die ?? m.dice ?? m.value);
    if (!dice) continue;
    out.push({
      dice,
      type: String(m.friendlySubtypeName ?? m.subType ?? defaultType),
      label: 'bonus',
    });
  }

  return out;
}

function formatWeaponRangeStr(def: any, merged: any): string | undefined {
  const normal = pickNumber(def.range, merged.range);
  const long = pickNumber(def.longRange, merged.longRange);
  if (normal != null && long != null) return `${normal}/${long}`;
  if (normal != null) return String(normal);
  return undefined;
}

export function actionToAttack(
  action: any,
  raw: any,
  abilities: GrimoireAbility[],
  idPrefix = '',
): GrimoireAttack | null {
  const name = action?.name ?? action?.definition?.name ?? action?.label;
  if (!name) return null;

  const entityId = pickNumber(action.entityId, action.itemId, action.inventoryId);
  const hint = weaponHintFromActionName(String(name));
  const linked = findInventoryWeapon(raw, hint, entityId ?? undefined);
  const merged = linked ? mergeWeaponItem(action, linked) : action;
  const def = merged.definition ?? {};

  const damageDice = extractActionDamage(merged);
  const damageType =
    merged.damageTypeName
    ?? merged.damageType
    ?? def.damageTypeName
    ?? def.damageType
    ?? 'damage';

  const properties = weaponPropertyNames(def);
  const extraDamages: { dice: string; type: string; label?: string }[] = [];
  const versatile = versatileDamageDice(def);
  if (versatile) extraDamages.push({ dice: versatile, type: damageType, label: 'Versatile' });
  extraDamages.push(...extractBonusDamages(def));

  const range =
    formatWeaponRangeStr(def, merged)
    ?? merged.attack?.range
    ?? merged.weaponBehaviors?.[0]?.range
    ?? merged.activation?.range;

  return {
    id: `${idPrefix}${action.id ?? action.definition?.id ?? name}`,
    name: String(name),
    toHit: extractActionToHit(merged, raw, abilities),
    damageDice: damageDice || '—',
    damageType,
    range: range != null ? String(range) : undefined,
    ...(properties.length ? { properties } : {}),
    ...(extraDamages.length ? { extraDamages } : {}),
  };
}

export function extractAllAttacks(raw: any, abilities: GrimoireAbility[]): GrimoireAttack[] {
  const attacks: GrimoireAttack[] = [];
  const seen = new Set<string>();

  function add(attack: GrimoireAttack | null) {
    if (!attack) return;
    const key = attack.id || attack.name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    attacks.push(attack);
  }

  const actionSources: [string, any[]][] = [
    ['custom', [...(raw.customActions ?? []), ...(raw.actions?.custom ?? [])]],
    ['class', raw.actions?.class ?? []],
    ['race', raw.actions?.race ?? []],
    ['feat', raw.actions?.feat ?? []],
    ['item', raw.actions?.item ?? []],
  ];

  for (const [source, list] of actionSources) {
    for (const action of list) {
      if (!isWeaponAttackEntry(action, source)) continue;
      add(actionToAttack(action, raw, abilities, source === 'custom' ? '' : `${source}-`));
    }
  }

  for (const item of raw.inventory ?? []) {
    if (!isItemEquipped(item)) continue;
    if (!inventoryItemIsWeapon(item)) continue;

    const def = item.definition ?? {};
    const itemKey = `wpn-${item.id ?? def.id ?? def.name}`;
    if (seen.has(itemKey)) continue;

    const behaviors = [
      ...(def.weaponBehaviors ?? []),
      ...(def.attackActions ?? []),
      ...(item.weaponBehaviors ?? []),
    ];

    if (behaviors.length) {
      for (const [i, behavior] of behaviors.entries()) {
        const merged = { ...behavior, name: behavior.name ?? def.name, definition: def };
        if (!isWeaponAttackEntry(merged, 'item')) continue;
        add(actionToAttack(merged, raw, abilities, `${itemKey}-b${i}-`));
      }
    } else {
      const merged = mergeWeaponItem({ name: def.name ?? item.name, definition: def }, item);
      add(actionToAttack(merged, raw, abilities, `${itemKey}-`));
    }
  }

  for (const attack of attacks) {
    if (attack.damageDice && attack.damageDice !== '—') continue;
    const hint = weaponHintFromActionName(attack.name);
    const linked = findInventoryWeapon(raw, hint);
    if (!linked) continue;
    const merged = mergeWeaponItem({}, linked);
    const dice = extractActionDamage(merged);
    if (dice) attack.damageDice = dice;
    if (!attack.toHit) attack.toHit = extractActionToHit(merged, raw, abilities);
  }

  return attacks;
}
