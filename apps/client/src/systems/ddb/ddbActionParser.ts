import { normalizeDiceNotation, type GrimoireAttack, type GrimoireCharacter, type GrimoireSpell } from '@grimoire/shared';
import { stripHtmlText } from '@/systems/compendium/actionDetail';

function defaultRange(): ActionRange {
  return { kind: 'melee', reachFt: 5 };
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

export function spellToParsedAction(spell: GrimoireSpell, character: GrimoireCharacter): ParsedAction {
  const damages = spell.damage ? [{ dice: normalizeDiceNotation(spell.damage), type: spell.damageType ?? 'damage' }] : [];
  const save = spellSave(spell, character);
  const toHit = spell.attack && character.spellAttackMod !== undefined ? character.spellAttackMod : undefined;

  return {
    name: spell.name,
    originalText: spell.name,
    section: 'actions',
    isTrait: false,
    ...(toHit !== undefined ? { toHit } : {}),
    ...(!spell.aoe ? { range: defaultRange() } : {}),
    ...(save ? { save } : {}),
    ...(spell.aoe ? { aoe: spell.aoe } : {}),
    damages,
    spells: spell.damage
      ? [{
          name: spell.name,
          dice: normalizeDiceNotation(spell.damage),
          ...(spell.aoe ? { aoe: spell.aoe } : {}),
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

export function parsePcActions(character: GrimoireCharacter): {
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
    .map((s) => spellToParsedAction(s, character));
  const features = character.features.map((f) => ({
    name: f.name,
    originalText: stripHtmlText(f.description ?? f.name),
    section: 'traits' as const,
    isTrait: true,
    damages: [] as ActionDamage[],
    spells: [] as ParsedAction['spells'],
    isSpellcastingBlock: false,
  }));
  return { attacks, spells, features };
}
