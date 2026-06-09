import { normalizeDiceNotation, type GrimoireAttack, type GrimoireCharacter, type GrimoireSpell } from '@grimoire/shared';
import { stripHtmlText } from '@/systems/compendium/actionDetail';
import {
  parseActionDamages,
  parseActionRange,
  parseActionToHit,
  RANGED_SPELL_RANGE,
  type ActionDamage,
  type ActionRange,
  type ParsedAction,
  type SpellLookup,
} from '@/systems/compendium/statBlockParser';

function defaultRange(): ActionRange {
  return { kind: 'melee', reachFt: 5 };
}

function spellRange(hasAttack: boolean, aoe?: { size: number; type: string }): ActionRange | undefined {
  if (aoe) return undefined;
  if (hasAttack) return RANGED_SPELL_RANGE;
  return undefined;
}

function parseRangeNumbers(range?: string): { normal?: number; long?: number } {
  if (!range) return {};
  const raw = String(range).trim();
  const slash = raw.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (slash) {
    return { normal: parseInt(slash[1]!, 10), long: parseInt(slash[2]!, 10) };
  }
  if (/^\d+$/.test(raw)) {
    const normal = parseInt(raw, 10);
    return { normal, long: normal * 3 };
  }
  return {};
}

function isThrownWeapon(attack: GrimoireAttack): boolean {
  const props = (attack.properties ?? []).map((p) => p.toLowerCase());
  if (props.includes('thrown')) return true;
  const name = attack.name.toLowerCase();
  return /spear|trident|handaxe|javelin|dart|net|throwing hammer|light hammer/i.test(name);
}

function isRangedWeapon(attack: GrimoireAttack): boolean {
  const props = (attack.properties ?? []).map((p) => p.toLowerCase());
  if (props.includes('range') || props.includes('ammunition')) return true;
  const name = attack.name.toLowerCase();
  return /bow|crossbow|sling|blowgun|firearm|gun/i.test(name);
}

function parseWeaponRange(attack: GrimoireAttack): ActionRange {
  const { normal, long } = parseRangeNumbers(attack.range);
  const thrown = isThrownWeapon(attack);
  const ranged = isRangedWeapon(attack);

  if (thrown) {
    const rangeNormalFt = normal ?? 20;
    const rangeLongFt = long ?? 60;
    return { kind: 'both', reachFt: 5, rangeNormalFt, rangeLongFt };
  }

  if (ranged) {
    return {
      kind: 'ranged',
      reachFt: 5,
      rangeNormalFt: normal ?? 80,
      ...(long != null ? { rangeLongFt: long } : {}),
    };
  }

  if (attack.range) {
    const lower = attack.range.toLowerCase();
    if (lower.includes('ranged')) {
      return {
        kind: 'ranged',
        reachFt: 5,
        rangeNormalFt: normal ?? 60,
        ...(long != null ? { rangeLongFt: long } : {}),
      };
    }
    const reach = lower.match(/reach\s*(\d+)/);
    if (reach) return { kind: 'melee', reachFt: parseInt(reach[1]!, 10) };
  }

  return defaultRange();
}

function damagesForAttack(attack: GrimoireAttack): ActionDamage[] {
  const damages: ActionDamage[] = [];
  const primary = attack.damageDice && attack.damageDice !== '—' ? attack.damageDice : '';
  if (primary) {
    damages.push({
      dice: primary,
      type: attack.damageType || 'damage',
      ...(attack.extraDamages?.length ? { label: 'Melee' } : {}),
    });
  }
  for (const extra of attack.extraDamages ?? []) {
    if (!extra.dice) continue;
    damages.push({
      dice: extra.dice,
      type: extra.type || attack.damageType || 'damage',
      ...(extra.label ? { label: extra.label } : {}),
    });
  }
  return damages;
}

function resolveAttackToHit(attack: GrimoireAttack, character: GrimoireCharacter): number {
  if (attack.toHit != null && attack.toHit !== 0) return attack.toHit;
  const prof = character.proficiencyBonus ?? 2;
  const str = character.abilities.find((a) => a.name === 'STR')?.mod ?? 0;
  const dex = character.abilities.find((a) => a.name === 'DEX')?.mod ?? 0;
  const name = attack.name.toLowerCase();
  if (/bow|crossbow|sling|gun|firearm|ranged|thrown|javelin|dart/i.test(name)) return dex + prof;
  if (/finesse|dagger|rapier|scimitar|shortsword|whip|spear|sap/i.test(name)) {
    return Math.max(str, dex) + prof;
  }
  return str + prof;
}

function expandThrownAttacks(base: ParsedAction, attack: GrimoireAttack): ParsedAction[] {
  const weaponRange = parseWeaponRange(attack);
  if (weaponRange.kind !== 'both') return [base];

  const meleeDamages = base.damages.map((d) => ({
    ...d,
    label: d.label ?? 'Melee',
  }));

  const melee: ParsedAction = {
    ...base,
    name: `${attack.name} (Melee)`,
    range: { kind: 'melee', reachFt: weaponRange.reachFt },
    damages: meleeDamages,
  };

  const thrown: ParsedAction = {
    ...base,
    name: `${attack.name} (Thrown)`,
    range: {
      kind: 'ranged',
      reachFt: 5,
      rangeNormalFt: weaponRange.rangeNormalFt ?? 20,
      rangeLongFt: weaponRange.rangeLongFt ?? 60,
    },
    damages: base.damages.map((d) => ({
      ...d,
      label: d.label ? `${d.label} (thrown)` : 'Thrown',
    })),
  };

  return [melee, thrown];
}

export function attackToParsedAction(attack: GrimoireAttack, character: GrimoireCharacter): ParsedAction {
  const toHit = resolveAttackToHit(attack, character);
  const base: ParsedAction = {
    name: attack.name,
    originalText: attack.name,
    section: 'actions',
    isTrait: false,
    toHit,
    range: parseWeaponRange(attack),
    damages: damagesForAttack(attack),
    spells: [],
    isSpellcastingBlock: false,
  };
  return base;
}

function spellSave(spell: GrimoireSpell, character: GrimoireCharacter): ParsedAction['save'] {
  const saveStat = spell.save;
  if (!saveStat) return undefined;
  const dc = character.spellSaveDc ?? 8 + (character.proficiencyBonus ?? 2);
  return { dc, stat: saveStat };
}

function resolveSpellToHit(spell: GrimoireSpell, character: GrimoireCharacter, isAttack = spell.attack): number | undefined {
  if (!isAttack) return undefined;
  if (character.spellAttackMod !== undefined) return character.spellAttackMod;
  if (character.spellSaveDc !== undefined) return character.spellSaveDc - 8;
  const prof = character.proficiencyBonus ?? 2;
  const castingMods = character.abilities
    .filter((a) => a.name === 'INT' || a.name === 'WIS' || a.name === 'CHA')
    .map((a) => a.mod);
  if (castingMods.length > 0) return Math.max(...castingMods) + prof;
  return undefined;
}

export function spellToParsedAction(
  spell: GrimoireSpell,
  character: GrimoireCharacter,
  lookup?: SpellLookup,
): ParsedAction {
  const data = lookup?.(spell.name);
  const damage = spell.damage ?? data?.damage;
  const damageType = spell.damageType ?? data?.type ?? 'damage';
  const damages: ActionDamage[] = [];
  if (damage) {
    damages.push({ dice: normalizeDiceNotation(damage), type: damageType });
  }
  if (data?.secondary) {
    damages.push({ dice: normalizeDiceNotation(data.secondary.damage), type: data.secondary.type });
  }

  const saveStat = spell.save ?? data?.save;
  const save = saveStat ? spellSave({ ...spell, save: saveStat }, character) : undefined;
  const isAttackSpell = Boolean(spell.attack || data?.attack);
  const aoe = spell.aoe ?? data?.aoe;
  const isSaveArea = Boolean(saveStat && damages.length > 0 && aoe && !isAttackSpell);
  const toHit = isAttackSpell && !isSaveArea ? resolveSpellToHit(spell, character, isAttackSpell) : undefined;
  const range = spellRange(Boolean(toHit !== undefined), aoe);

  return {
    name: spell.name,
    originalText: spell.name,
    section: 'actions',
    isTrait: false,
    ...(toHit !== undefined ? { toHit } : {}),
    ...(range ? { range } : {}),
    ...(save ? { save } : {}),
    ...(aoe ? { aoe } : {}),
    damages,
    spells: damage
      ? [{
          name: spell.name,
          dice: normalizeDiceNotation(damage),
          ...(aoe ? { aoe } : {}),
        }]
      : [],
    isSpellcastingBlock: false,
  };
}

function attacksFromEquippedInventory(character: GrimoireCharacter): GrimoireAttack[] {
  const equippedWeapons = (character.inventory ?? []).filter(
    (item) => item.equipped && /spear|trident|sword|axe|bow|crossbow|dagger|mace|hammer|whip|javelin|club|staff|unarmed|sap|lance|glaive|halberd|rapier|scimitar|sling|gun|firearm/i.test(item.name),
  );
  if (!equippedWeapons.length) return [];

  return equippedWeapons.map((item) => ({
    id: `inv-${item.id}`,
    name: item.name,
    toHit: 0,
    damageDice: '—',
    damageType: 'damage',
    ...(/spear|trident|handaxe|javelin|dart|net/i.test(item.name) ? { properties: ['Thrown'], range: '20/60' } : {}),
  }));
}

export function parsePcActions(
  character: GrimoireCharacter,
  lookup?: SpellLookup,
): {
  attacks: ParsedAction[];
  spells: ParsedAction[];
  features: ParsedAction[];
} {
  const attackSource = character.attacks.length
    ? character.attacks
    : attacksFromEquippedInventory(character);

  const attacks = attackSource.flatMap((a) => {
    const parsed = attackToParsedAction(a, character);
    return isThrownWeapon(a) ? expandThrownAttacks(parsed, a) : [parsed];
  });

  const spells = character.spells
    .filter((s) => s.prepared || s.level === 0)
    .map((s) => spellToParsedAction(s, character, lookup));
  const featureActions: ParsedAction[] = [];
  const features: ParsedAction[] = [];

  for (const f of character.features) {
    const originalText = stripHtmlText(f.description ?? f.name);
    const range = parseActionRange(originalText);
    const damages = parseActionDamages(originalText, range, f.name);
    const parsedToHit = parseActionToHit(originalText);

    if (damages.length > 0 || parsedToHit !== undefined) {
      const pseudoAttack: GrimoireAttack = {
        id: f.id,
        name: f.name,
        toHit: parsedToHit ?? 0,
        damageDice: damages[0]?.dice ?? '—',
        damageType: damages[0]?.type ?? 'damage',
      };
      const rollable = attackToParsedAction(pseudoAttack, character);
      rollable.originalText = originalText;
      rollable.damages = damages.length > 0 ? damages : rollable.damages;
      rollable.range = range;
      rollable.isTrait = false;
      rollable.section = 'actions';
      featureActions.push(rollable);
      continue;
    }

    features.push({
      name: f.name,
      originalText,
      section: 'traits',
      isTrait: true,
      damages: [] as ActionDamage[],
      spells: [] as ParsedAction['spells'],
      isSpellcastingBlock: false,
    });
  }

  return { attacks: [...attacks, ...featureActions], spells, features };
}
