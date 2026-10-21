import type { GrimoireCharacter } from '@grimoire/shared';
import type { DdbRollBridgePayload } from '@grimoire/shared';

/** Standard ability / skill checks a prop can require. */
export interface PropActivateCheckDef {
  id: string;
  label: string;
  /** 'skill' | 'ability' — how to look up the modifier on a character. */
  kind: 'skill' | 'ability';
  /** Ability score short name for ability checks (STR, DEX, …). */
  ability?: string;
  /** Aliases matched in D&D Beyond roll labels. */
  aliases: string[];
}

export const PROP_ACTIVATE_CHECKS: PropActivateCheckDef[] = [
  {
    id: 'strength',
    label: 'Strength',
    kind: 'ability',
    ability: 'STR',
    aliases: ['strength', 'str', 'str check', 'strength check', 'strength ability', 'ability check strength'],
  },
  {
    id: 'dexterity',
    label: 'Dexterity',
    kind: 'ability',
    ability: 'DEX',
    aliases: ['dexterity', 'dex', 'dex check', 'dexterity check', 'dexterity ability', 'ability check dexterity'],
  },
  {
    id: 'constitution',
    label: 'Constitution',
    kind: 'ability',
    ability: 'CON',
    aliases: ['constitution', 'con', 'con check', 'constitution check', 'ability check constitution'],
  },
  {
    id: 'intelligence',
    label: 'Intelligence',
    kind: 'ability',
    ability: 'INT',
    aliases: ['intelligence', 'int', 'int check', 'intelligence check', 'ability check intelligence'],
  },
  {
    id: 'wisdom',
    label: 'Wisdom',
    kind: 'ability',
    ability: 'WIS',
    aliases: ['wisdom', 'wis', 'wis check', 'wisdom check', 'ability check wisdom'],
  },
  {
    id: 'charisma',
    label: 'Charisma',
    kind: 'ability',
    ability: 'CHA',
    aliases: ['charisma', 'cha', 'cha check', 'charisma check', 'ability check charisma'],
  },
  {
    id: 'athletics',
    label: 'Athletics',
    kind: 'skill',
    aliases: ['athletics'],
  },
  {
    id: 'acrobatics',
    label: 'Acrobatics',
    kind: 'skill',
    aliases: ['acrobatics'],
  },
  {
    id: 'sleight-of-hand',
    label: 'Sleight of Hand',
    kind: 'skill',
    aliases: ['sleight of hand', 'sleight-of-hand'],
  },
  {
    id: 'stealth',
    label: 'Stealth',
    kind: 'skill',
    aliases: ['stealth'],
  },
  {
    id: 'arcana',
    label: 'Arcana',
    kind: 'skill',
    aliases: ['arcana'],
  },
  {
    id: 'history',
    label: 'History',
    kind: 'skill',
    aliases: ['history'],
  },
  {
    id: 'investigation',
    label: 'Investigation',
    kind: 'skill',
    aliases: ['investigation'],
  },
  {
    id: 'nature',
    label: 'Nature',
    kind: 'skill',
    aliases: ['nature'],
  },
  {
    id: 'religion',
    label: 'Religion',
    kind: 'skill',
    aliases: ['religion'],
  },
  {
    id: 'animal-handling',
    label: 'Animal Handling',
    kind: 'skill',
    aliases: ['animal handling', 'animal-handling'],
  },
  {
    id: 'insight',
    label: 'Insight',
    kind: 'skill',
    aliases: ['insight'],
  },
  {
    id: 'medicine',
    label: 'Medicine',
    kind: 'skill',
    aliases: ['medicine'],
  },
  {
    id: 'perception',
    label: 'Perception',
    kind: 'skill',
    aliases: ['perception'],
  },
  {
    id: 'survival',
    label: 'Survival',
    kind: 'skill',
    aliases: ['survival'],
  },
  {
    id: 'deception',
    label: 'Deception',
    kind: 'skill',
    aliases: ['deception'],
  },
  {
    id: 'intimidation',
    label: 'Intimidation',
    kind: 'skill',
    aliases: ['intimidation'],
  },
  {
    id: 'performance',
    label: 'Performance',
    kind: 'skill',
    aliases: ['performance'],
  },
  {
    id: 'persuasion',
    label: 'Persuasion',
    kind: 'skill',
    aliases: ['persuasion'],
  },
];

const BY_ID = new Map(PROP_ACTIVATE_CHECKS.map((c) => [c.id, c]));

export function propActivateCheckDef(id: string | undefined | null): PropActivateCheckDef | undefined {
  if (!id) return undefined;
  return BY_ID.get(id);
}

export function formatModNotation(mod: number): string {
  if (mod === 0) return '1d20';
  return mod > 0 ? `1d20+${mod}` : `1d20${mod}`;
}

/** Look up skill or ability modifier on a synced D&D Beyond / Grimoire character. */
export function resolveCheckMod(
  character: GrimoireCharacter,
  checkId: string,
): { mod: number; label: string } | null {
  const def = propActivateCheckDef(checkId);
  if (!def) return null;

  if (def.kind === 'ability' && def.ability) {
    const want = def.ability.toUpperCase();
    const wantFull = def.label.toUpperCase();
    const ab = character.abilities.find((a) => {
      const n = a.name.trim().toUpperCase();
      return n === want || n === wantFull || n.startsWith(want) || want.startsWith(n);
    });
    if (!ab) return { mod: 0, label: def.label };
    return { mod: ab.mod, label: def.label };
  }

  const skill = character.skills.find(
    (s) => s.name.toLowerCase() === def.label.toLowerCase(),
  );
  if (!skill) return { mod: 0, label: def.label };
  return { mod: skill.mod, label: def.label };
}

/** Normalize roll labels: middle dots, slashes, etc. → spaces so "You · STR check" matches. */
function normalizeHay(s: string): string {
  return s
    .toLowerCase()
    .replace(/[·•∙⋅]/g, ' ')
    .replace(/[_/|,;:()[\]{}-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWholeWord(hay: string, word: string): boolean {
  if (!word) return false;
  const re = new RegExp(`(?:^|\\s)${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|\\s)`);
  return re.test(hay);
}

/** True when a roll label/notation matches this check (skill / ability). */
export function rollLabelMatchesCheck(
  label: string,
  notation: string | undefined,
  checkId: string,
): boolean {
  const def = propActivateCheckDef(checkId);
  if (!def) return false;

  const hay = normalizeHay(`${label} ${notation ?? ''}`);
  if (!hay) return false;

  // Weapon / damage rolls must not open props.
  if (/\b(damage|dmg|to hit|attack roll)\b/.test(hay) && !/\bcheck\b/.test(hay)) return false;
  // Saving throws are not ability/skill checks for prop gates.
  if (/\b(save|saving throw)\b/.test(hay)) return false;

  // Ability checks: sheet uses "STR check", DDB uses "Strength" / "Strength Check".
  if (def.kind === 'ability' && def.ability) {
    const ab = def.ability.toLowerCase();
    const full = def.label.toLowerCase();
    if (hay === ab || hay === full) return true;
    if (hasWholeWord(hay, ab) && /\bcheck\b/.test(hay)) return true;
    if (hasWholeWord(hay, full) && (/\bcheck\b/.test(hay) || /\bability\b/.test(hay))) return true;
    if (hasWholeWord(hay, full) && !/\b(skill|save)\b/.test(hay)) {
      // Bare "Strength" from DDB ability check / Use roll without the word "check".
      return true;
    }
    if (hay.includes(`ability check ${full}`) || hay.includes(`ability check ${ab}`)) return true;
  }

  const needles = [def.label, ...def.aliases].map(normalizeHay);
  return needles.some((n) => {
    if (!n) return false;
    // Avoid short ability codes matching inside longer words via aliases alone —
    // those are handled above with whole-word checks.
    if (def.kind === 'ability' && def.ability && n === def.ability.toLowerCase()) return false;

    if (hay === n) return true;
    if (hay.includes(`${n} check`)) return true;
    if (hay.includes(`check ${n}`)) return true;
    if (hasWholeWord(hay, n)) {
      // Skills on the sheet are often "You · Athletics" with no "check" word.
      if (def.kind === 'skill') return true;
      return /\b(check|skill|ability)\b/.test(hay);
    }
    return false;
  });
}

/** True when a D&D Beyond roll label matches this check (skill / ability). */
export function ddbRollMatchesCheck(payload: DdbRollBridgePayload, checkId: string): boolean {
  if (payload.isDamage) return false;
  return rollLabelMatchesCheck(payload.label, payload.notation, checkId);
}

/** Which linked check id (if any) this roll label looks like. */
export function guessCheckIdFromRollLabel(label: string, notation?: string): string | undefined {
  // Prefer longer labels first (Sleight of Hand before Hand).
  const ordered = [...PROP_ACTIVATE_CHECKS].sort((a, b) => b.label.length - a.label.length);
  for (const def of ordered) {
    if (rollLabelMatchesCheck(label, notation, def.id)) return def.id;
  }
  return undefined;
}
