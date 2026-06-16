/** Parsed stat-block roll data (ported from Owlbear popover.js). */

export interface AbilityScore {
  name: string;
  score: number;
  mod: number;
}

export interface SavingThrow {
  name: string;
  mod: number;
}

export interface ActionDamage {
  dice: string;
  type: string;
  /** Melee, Ranged, Melee / Ranged, Melee (two-handed), etc. */
  label?: string;
}

export function formatActionDamage(dmg: ActionDamage): string {
  const dice =
    typeof dmg.dice === 'string'
      ? dmg.dice.trim()
      : dmg.dice == null
        ? ''
        : String(dmg.dice).trim();
  const base = dice ? `${dice} ${dmg.type}` : dmg.type;
  return dmg.label ? `${base} · ${dmg.label}` : base;
}

export function formatAoeLabel(aoe: { size: number; type: string }): string {
  const type = aoe.type.toLowerCase();
  if (type === 'radius' || type === 'sphere') return `${aoe.size} ft radius`;
  return `${aoe.size} ft ${type}`;
}

export function isSaveAreaAction(action: ParsedAction): boolean {
  return Boolean(
    action.save
    && action.damages.length > 0
    && action.toHit === undefined
    && hasAoeTemplate(action.aoe),
  );
}

/** Default range for single-target spell attacks (120 ft). */
export const RANGED_SPELL_RANGE: ActionRange = { kind: 'ranged', reachFt: 5, rangeNormalFt: 120 };

function spellDamagesFromData(
  damage?: string,
  type?: string,
  secondary?: { damage: string; type: string },
): ActionDamage[] {
  const out: ActionDamage[] = [];
  if (damage) out.push({ dice: damage.replace(/\s+/g, ''), type: type ?? 'damage' });
  if (secondary) out.push({ dice: secondary.damage.replace(/\s+/g, ''), type: secondary.type });
  return out;
}

/** Build a combat ParsedAction from compendium spell data. */
export function compendiumSpellToParsedAction(
  spell: {
    name: string;
    damage?: string;
    type?: string;
    save?: string;
    attack?: boolean;
    aoe?: { size: number; type: string };
    secondary?: { damage: string; type: string };
    description?: string;
  },
  opts?: { toHit?: number; saveDc?: number },
): ParsedAction {
  const enriched = enrichSpellData(spell);
  const merged = {
    name: spell.name,
    damage: enriched.damage ?? spell.damage,
    type: enriched.type ?? spell.type,
    save: enriched.save ?? spell.save,
    attack: enriched.attack ?? spell.attack,
    aoe: enriched.aoe ?? spell.aoe,
    secondary: spell.secondary,
    description: enriched.description ?? spell.description,
  };
  const damages = spellDamagesFromData(merged.damage, merged.type, merged.secondary);
  const isSaveArea = Boolean(merged.save && damages.length > 0 && hasAoeTemplate(merged.aoe) && !merged.attack);
  const toHit = merged.attack && !isSaveArea && opts?.toHit !== undefined ? opts.toHit : undefined;

  return {
    name: merged.name,
    originalText: merged.description?.trim() || merged.name,
    section: 'actions',
    isTrait: false,
    ...(toHit !== undefined ? { toHit } : {}),
    ...(merged.save ? { save: { dc: opts?.saveDc ?? 13, stat: merged.save } } : {}),
    ...(merged.aoe ? { aoe: merged.aoe } : {}),
    ...(!merged.aoe && toHit !== undefined ? { range: RANGED_SPELL_RANGE } : {}),
    damages,
    spells: [],
    isSpellcastingBlock: false,
  };
}

/** Save-for-half spell with area template (fireball, lightning bolt, etc.). */
export function isSaveAreaSpell(
  spell: { aoe?: { size: number; type: string } },
  data: SpellLookupData | undefined,
  opts: { hasSave: boolean; hasAttack?: boolean; damages: ActionDamage[] },
): boolean {
  const aoe = spell.aoe ?? data?.aoe;
  return Boolean(opts.hasSave && opts.damages.length > 0 && aoe && !opts.hasAttack);
}

export function spellEffectName(spell: { name: string; label?: string }): string {
  return spell.label ? `${spell.name} (${spell.label})` : spell.name;
}

export function hasAoeTemplate(aoe?: { size: number; type: string }): aoe is { size: number; type: string } {
  return Boolean(aoe && aoe.size > 0 && aoe.type);
}

export interface ActionSpell {
  name: string;
  dice: string | null;
  label?: string;
  aoe?: { size: number; type: string };
}

export type ActionAttackKind = 'melee' | 'ranged' | 'both' | 'unknown';

export interface ActionRange {
  kind: ActionAttackKind;
  /** Melee reach in feet (default 5). */
  reachFt: number;
  rangeNormalFt?: number;
  rangeLongFt?: number;
}

export interface ParsedAction {
  name: string;
  originalText: string;
  section: 'traits' | 'actions' | 'reactions' | 'legendary';
  isTrait: boolean;
  toHit?: number;
  range?: ActionRange;
  save?: { dc: number; stat: string };
  aoe?: { size: number; type: string };
  damages: ActionDamage[];
  spells: ActionSpell[];
  /** Spellcasting / innate block that owns {@link spells} roster. */
  isSpellcastingBlock?: boolean;
  /** Parent spellcasting action name when expanded from a roster. */
  spellParent?: string;
}

export interface SpellLookupData {
  name: string;
  damage?: string;
  type?: string;
  save?: string;
  attack?: boolean;
  aoe?: { size: number; type: string };
  secondary?: { damage: string; type: string };
  concentration?: boolean;
  description?: string;
}

export type SpellLookup = (name: string) => SpellLookupData | undefined;

const SHORT_MAP: Record<string, string> = {
  Strength: 'STR',
  Dexterity: 'DEX',
  Constitution: 'CON',
  Intelligence: 'INT',
  Wisdom: 'WIS',
  Charisma: 'CHA',
};

const ABILITY_ORDER = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];

export function parseStatsObject(stats: Record<string, unknown>): AbilityScore[] {
  const map: Record<string, string> = {
    str: 'STR', dex: 'DEX', con: 'CON', int: 'INT', wis: 'WIS', cha: 'CHA',
  };
  const result: AbilityScore[] = [];

  for (const [key, val] of Object.entries(stats)) {
    const name = map[key.toLowerCase()];
    if (!name) continue;
    const score = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (Number.isNaN(score)) continue;
    result.push({ name, score, mod: Math.floor((score - 10) / 2) });
  }

  return result.sort((a, b) => ABILITY_ORDER.indexOf(a.name) - ABILITY_ORDER.indexOf(b.name));
}

export function parseAbilities(text: string): AbilityScore[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\blnt\b/gi, 'Int');
  const abilities: AbilityScore[] = [];
  const regex = /(STR|DEX|CON|INT|WIS|CHA|Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*(\d+)\s*\(([+-]\d+)\)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(normalized)) !== null) {
    let name = match[1]!.toUpperCase();
    if (SHORT_MAP[match[1]!]) name = SHORT_MAP[match[1]!]!;
    if (!abilities.find((a) => a.name === name)) {
      abilities.push({
        name,
        score: parseInt(match[2]!, 10),
        mod: parseInt(match[3]!, 10),
      });
    }
  }

  if (abilities.length === 0) {
    const blockRegex = /(\d+)\s*\(([+-]\d+)\)\s*(\d+)\s*\(([+-]\d+)\)\s*(\d+)\s*\(([+-]\d+)\)\s*(\d+)\s*\(([+-]\d+)\)\s*(\d+)\s*\(([+-]\d+)\)\s*(\d+)\s*\(([+-]\d+)\)/;
    const blockMatch = normalized.match(blockRegex);
    if (blockMatch) {
      for (let i = 0; i < 6; i++) {
        abilities.push({
          name: ABILITY_ORDER[i]!,
          score: parseInt(blockMatch[i * 2 + 1]!, 10),
          mod: parseInt(blockMatch[i * 2 + 2]!, 10),
        });
      }
    }
  }

  return abilities;
}

export function parseSavingThrows(text: string): SavingThrow[] {
  if (!text) return [];
  const normalized = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ');
  const match = normalized.match(/Saving Throws\s+(.*?)(?=\.|Skills|Damage|Condition|Senses|Languages|Challenge|$)/i);
  if (!match) return [];

  const savesStr = match[1]!.replace(/\blnt\b/gi, 'Int');
  const saves: SavingThrow[] = [];
  const saveRegex = /([a-zA-Z]+)\s*([+-]\d+)/g;
  let saveMatch: RegExpExecArray | null;
  while ((saveMatch = saveRegex.exec(savesStr)) !== null) {
    saves.push({ name: saveMatch[1]!, mod: parseInt(saveMatch[2]!, 10) });
  }
  return saves;
}

/** Parse attack bonus from action text (5e / Owlbear / 2024 / D&D Beyond stat block variants). */
export function parseActionToHit(fullText: string): number | undefined {
  const patterns = [
    /(?:Melee(?:\/Ranged)?(?:\s+or\s+Ranged)?\s+Weapon\s+Attack|Ranged\s+Weapon\s+Attack|Weapon\s+Attack|Spell\s+Attack|Melee\s+Attack\s+Roll|Ranged\s+Attack\s+Roll|Melee\s+Attack|Ranged\s+Attack)[\s.:,]*\+?\s*([+-]?\d+)\s*to\s*hit/i,
    /(?:Melee|Ranged)\s+Attack\s+Roll[\s.:,]*\+?\s*([+-]?\d+)/i,
    /Attack\s+Roll[\s.:,]*\+?\s*([+-]?\d+)/i,
    /([+-]\d+)\s*to\s*hit(?:\s*,|\s*\.|\s*;|\s+reach|\s+range|\s+one)/i,
    /([+-]\d+)\s*to\s*hit/i,
  ];
  for (const re of patterns) {
    const m = fullText.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function isAttackRollDice(dice: string): boolean {
  return /^1d20([+-]\d+)?$/i.test(dice.replace(/\s+/g, ''));
}

function extractFlatModifier(expr: string): { dicePart: string; mod: number } {
  const cleaned = expr.trim().replace(/\s+/g, '');
  const modMatch = cleaned.match(/^(.+?)([+-]\d+)$/);
  if (modMatch && /\d+d\d+/i.test(modMatch[1]!)) {
    return { dicePart: modMatch[1]!, mod: parseInt(modMatch[2]!, 10) };
  }
  return { dicePart: cleaned, mod: 0 };
}

/** Join "1d6 + 4 plus 1d8" into a single roll expression: 1d6+1d8+4 */
function combineDiceParts(parts: string[]): string {
  const diceGroups: string[] = [];
  let totalMod = 0;
  for (const raw of parts) {
    const { dicePart, mod } = extractFlatModifier(raw.trim());
    const re = /(\d*d\d+)/gi;
    let m: RegExpExecArray | null;
    let hasDice = false;
    while ((m = re.exec(dicePart)) !== null) {
      diceGroups.push(m[1]!);
      hasDice = true;
    }
    totalMod += mod;
  }
  if (diceGroups.length === 0) return parts.join('+').replace(/\s+/g, '');
  let out = diceGroups.join('+');
  if (totalMod !== 0) out += totalMod >= 0 ? `+${totalMod}` : `${totalMod}`;
  return out;
}

function inferDamageLabel(context: string, actionRange?: ActionRange): string | undefined {
  const lower = context.toLowerCase();
  if (/two[\s-]?hand|two hands/i.test(lower)) return 'Melee (two-handed)';
  if (/\branged\b/.test(lower) && /\bmelee\b/.test(lower)) return 'Melee / Ranged';
  if (/\branged attack\b|\bthrown\b|\brange \d/i.test(lower) && !/\bmelee\b/.test(lower)) return 'Ranged';
  if (/\bmelee attack\b/i.test(lower) && !/\branged\b|\bor range\b/i.test(lower)) return 'Melee';
  if (actionRange?.kind === 'both') return 'Melee / Ranged';
  if (actionRange?.kind === 'melee') return 'Melee';
  if (actionRange?.kind === 'ranged') return 'Ranged';
  return undefined;
}

function sliceHitContext(normalized: string, matchIndex: number, matchLength: number): string {
  const after = normalized.slice(matchIndex + matchLength);
  const nextOr = after.search(/,\s*or\s+\d+\s*\(/i);
  const end = nextOr >= 0 ? nextOr : Math.min(after.length, 80);
  return after.slice(0, end);
}

/** Dice faces only, e.g. 1d6+1d8+4 → d6+d8 */
function damageDiceSignature(dice: string): string {
  const cleaned = dice.replace(/\s+/g, '');
  const body = cleaned.replace(/[+-]\d+$/, '');
  const groups: string[] = [];
  const re = /(\d*)d(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const count = m[1] ? parseInt(m[1], 10) : 1;
    const sides = m[2]!;
    for (let i = 0; i < (Number.isFinite(count) && count > 0 ? count : 1); i++) {
      groups.push(`d${sides}`);
    }
  }
  return groups.sort().join('+');
}

function damageFlatModifier(dice: string): number {
  const m = dice.replace(/\s+/g, '').match(/([+-]\d+)$/);
  return m ? parseInt(m[1]!, 10) : 0;
}

/** Drop bare dice (d6+d8) when the same hit has a version with modifiers (1d6+1d8+4). */
function pruneDamageDuplicates(damages: ActionDamage[]): ActionDamage[] {
  return damages.filter((entry, i, arr) => {
    const sig = damageDiceSignature(entry.dice);
    const mod = damageFlatModifier(entry.dice);
    const type = entry.type;
    const label = entry.label ?? '';

    if (mod !== 0) return true;

    const hasModifierSibling = arr.some(
      (other, j) =>
        j !== i &&
        other.type === type &&
        (other.label ?? '') === label &&
        damageDiceSignature(other.dice) === sig &&
        damageFlatModifier(other.dice) !== 0,
    );
    if (hasModifierSibling) return false;

    const hasRicherSibling = arr.some(
      (other, j) =>
        j !== i &&
        other.type === type &&
        (other.label ?? '') === label &&
        damageDiceSignature(other.dice) === sig &&
        other.dice.replace(/\s+/g, '').length > entry.dice.replace(/\s+/g, '').length,
    );
    return !hasRicherSibling;
  });
}

function parseActionAoe(fullText: string): { size: number; type: string } | undefined {
  const normalized = fullText.replace(/\r\n/g, ' ');
  const patterns = [
    /(\d+)\s*-?\s*(?:foot|ft\.?)\s+(cone|line|cube|sphere|radius|cylinder)/i,
    /(\d+)\s*ft\.?\s*-?\s*(?:wide\s+)?(cone|line|cube|sphere)/i,
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m) return { size: parseInt(m[1]!, 10), type: m[2]!.toLowerCase() };
  }
  return undefined;
}

function cleanParsedDamageType(raw: string, fullText: string, actionName?: string): string {
  for (const src of [raw, fullText, actionName ?? '']) {
    if (!src.trim()) continue;
    const lower = src.toLowerCase();
    for (const type of [
      'acid', 'bludgeoning', 'cold', 'fire', 'force', 'lightning', 'necrotic',
      'piercing', 'poison', 'psychic', 'radiant', 'slashing', 'thunder',
    ] as const) {
      if (new RegExp(`\\b${type}\\b`).test(lower)) return type;
    }
  }
  const trimmed = raw.trim().toLowerCase().replace(/\s+damage$/, '').replace(/[^a-z]/g, '');
  return trimmed || 'damage';
}

function finalizeDamageTypes(
  damages: ActionDamage[],
  fullText: string,
  actionName?: string,
): ActionDamage[] {
  const fallback = cleanParsedDamageType('', fullText, actionName);
  return damages.map((entry) => ({
    ...entry,
    type:
      entry.type === 'damage' && fallback !== 'damage'
        ? fallback
        : cleanParsedDamageType(entry.type, fullText, actionName),
  }));
}

export function parseActionDamages(fullText: string, actionRange?: ActionRange, actionName?: string): ActionDamage[] {
  const normalized = fullText.replace(/\r\n/g, ' ');
  const damages: ActionDamage[] = [];
  const seen = new Set<string>();

  function addDamage(parens: string, type: string, context: string) {
    const parts = parens.split(/\s+plus\s+/i).map((s) => s.trim()).filter(Boolean);
    const dice = parts.length > 1 ? combineDiceParts(parts) : parts[0]!.replace(/\s+/g, '');
    if (!dice || isAttackRollDice(dice)) return;
    const cleanType = cleanParsedDamageType(type, `${context} ${normalized}`, actionName);
    const label = inferDamageLabel(context, actionRange);
    const key = `${dice}|${cleanType}|${label ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    const entry: ActionDamage = { dice, type: cleanType };
    if (label) entry.label = label;
    damages.push(entry);
  }

  // Save effect with average prefix: taking 54 (12d8) cold damage on a failed save
  const saveFailAvgRe =
    /taking\s+\d+\s*\(([^)]+)\)\s*(\w+(?:\s+\w+)?)\s+damage on a failed/gi;
  let m: RegExpExecArray | null;
  while ((m = saveFailAvgRe.exec(normalized)) !== null) {
    addDamage(m[1]!, m[2]!, m[0]);
  }

  const saveFailRe =
    /taking\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)\s+(\w+(?:\s+\w+)?)\s+damage on a failed/gi;
  while ((m = saveFailRe.exec(normalized)) !== null) {
    addDamage(m[1]!, m[2]!, m[0]);
  }

  if (damages.length > 0) return finalizeDamageTypes(pruneDamageDuplicates(damages), normalized, actionName);

  const primaryRe = /Hit:\s*\d+\s*\(([^)]+)\)\s*(\w+(?:\s+\w+)?)\s+damage/gi;
  while ((m = primaryRe.exec(normalized)) !== null) {
    addDamage(m[1]!, m[2]!, sliceHitContext(normalized, m.index, m[0].length));
  }

  const altRe = /\bor\s+\d+\s*\(([^)]+)\)\s*(\w+(?:\s+\w+)?)\s+damage/gi;
  while ((m = altRe.exec(normalized)) !== null) {
    addDamage(m[1]!, m[2]!, normalized.slice(m.index, m.index + 120));
  }

  if (damages.length > 0) return finalizeDamageTypes(pruneDamageDuplicates(damages), normalized, actionName);

  const looseRe =
    /(?:Hit:|taking|takes?)\s*(?:\d+)?\s*\(([^)]+)\)\s*(\w+(?:\s+\w+)?)\s+damage/gi;
  while ((m = looseRe.exec(normalized)) !== null) {
    addDamage(m[1]!, m[2]!, m[0]);
  }

  if (damages.length > 0) return finalizeDamageTypes(pruneDamageDuplicates(damages), normalized, actionName);

  const anyDiceRegex = /(\d+d\d+(?:\s*[+-]\s*\d+)?)/gi;
  while ((m = anyDiceRegex.exec(normalized)) !== null) {
    const dice = m[1]!.replace(/\s+/g, '');
    if (isAttackRollDice(dice) || seen.has(dice)) continue;
    seen.add(dice);
    const context = normalized.slice(m.index, m.index + 80);
    const type = cleanParsedDamageType('', context, actionName);
    const entry: ActionDamage = { dice, type };
    const label = inferDamageLabel(normalized, actionRange);
    if (label) entry.label = label;
    damages.push(entry);
  }

  return finalizeDamageTypes(pruneDamageDuplicates(damages), normalized, actionName);
}

function buildActionRange(
  kind: ActionAttackKind,
  reachFt: number,
  rangeNormalFt?: number,
  rangeLongFt?: number,
): ActionRange {
  const range: ActionRange = { kind, reachFt };
  if (rangeNormalFt !== undefined) range.rangeNormalFt = rangeNormalFt;
  if (rangeLongFt !== undefined) range.rangeLongFt = rangeLongFt;
  return range;
}

/** Parse melee reach / ranged distance from action text. */
export function parseActionRange(fullText: string): ActionRange {
  const text = fullText.replace(/\r\n/g, ' ');
  const meleeOrRanged = /Melee\s+or\s+Ranged(?:\s+Weapon)?\s+Attack/i.test(text);
  const isRanged = /Ranged(?:\s+Weapon)?\s+Attack/i.test(text);
  const isMelee = /Melee(?:\s+Weapon)?\s+Attack/i.test(text);
  const isSpellAttack = /Spell\s+Attack/i.test(text);

  let reachFt = 5;
  const reachMatch = text.match(/reach\s+(\d+)\s*ft\.?/i);
  if (reachMatch) reachFt = parseInt(reachMatch[1]!, 10);

  let rangeNormalFt: number | undefined;
  let rangeLongFt: number | undefined;

  const rangeSlash = text.match(/range\s+(\d+)\s*\/\s*(\d+)\s*ft\.?/i);
  if (rangeSlash) {
    rangeNormalFt = parseInt(rangeSlash[1]!, 10);
    rangeLongFt = parseInt(rangeSlash[2]!, 10);
  } else {
    const rangeSingle = text.match(/range\s+(\d+)\s*ft\.?/i);
    if (rangeSingle) rangeNormalFt = parseInt(rangeSingle[1]!, 10);
  }

  if (meleeOrRanged) {
    return buildActionRange('both', reachFt, rangeNormalFt, rangeLongFt);
  }
  if (isRanged || (isSpellAttack && rangeNormalFt !== undefined)) {
    return buildActionRange('ranged', reachFt, rangeNormalFt, rangeLongFt);
  }
  if (isMelee || reachMatch) {
    return buildActionRange('melee', reachFt, rangeNormalFt, rangeLongFt);
  }
  if (isSpellAttack) {
    return buildActionRange('ranged', reachFt, rangeNormalFt ?? 120);
  }
  if (rangeNormalFt !== undefined) {
    return buildActionRange('ranged', reachFt, rangeNormalFt, rangeLongFt);
  }
  if (toHitInText(fullText)) {
    return buildActionRange('melee', 5);
  }
  return buildActionRange('unknown', 5);
}

function toHitInText(text: string): boolean {
  return parseActionToHit(text) !== undefined;
}

function normalizeSpellName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function parseAoeFromDescription(text: string): { size: number; type: string } | undefined {
  const radius =
    /(\d+)[- ]foot[- ]radius(?:\s+(sphere|cylinder))?/i.exec(text)
    ?? /(\d+)\s*ft\.?\s*radius/i.exec(text);
  if (radius) {
    const kind = radius[2]?.toLowerCase() === 'cylinder' ? 'cylinder' : 'sphere';
    return { size: Number(radius[1]), type: kind };
  }
  const cone = /(\d+)[- ]foot[- ]cone/i.exec(text);
  if (cone) return { size: Number(cone[1]), type: 'cone' };
  const line = /(\d+)[- ]foot[- ]long,\s*(\d+)[- ]foot[- ]wide\s+line/i.exec(text);
  if (line) return { size: Number(line[1]), type: 'line' };
  const cube = /(\d+)[- ]foot[- ]cube/i.exec(text);
  if (cube) return { size: Number(cube[1]), type: 'cube' };
  return undefined;
}

/** Fill attack / save / damage from spell description when compendium fields are missing. */
export function enrichSpellData(spell: {
  name: string;
  damage?: string;
  type?: string;
  save?: string;
  attack?: boolean;
  aoe?: { size: number; type: string };
  secondary?: { damage: string; type: string };
  concentration?: boolean;
  description?: string;
}): SpellLookupData {
  const text = spell.description ?? '';
  let damage = spell.damage;
  let type = spell.type;
  let save = spell.save;
  let attack = spell.attack;

  if (!damage) {
    const dmgMatch = text.match(/(\d+d\d+(?:\s*\+\s*\d+)?)\s+([\w]+)\s+damage/i);
    if (dmgMatch) {
      damage = dmgMatch[1]!.replace(/\s+/g, '');
      type = type ?? dmgMatch[2];
    }
  }

  if (!save) {
    const saveMatch = text.match(/(\w+)\s+saving throw/i);
    if (saveMatch) {
      const stat = saveMatch[1]!;
      save = stat.length <= 3 ? stat.toUpperCase() : stat.slice(0, 3).toUpperCase();
    }
  }

  if (!attack && /spell attack roll|ranged spell attack|melee spell attack|make a ranged spell attack/i.test(text)) {
    attack = true;
  }

  const concentration = spell.concentration ?? /concentration/i.test(text);
  const aoe = spell.aoe ?? parseAoeFromDescription(text);

  return {
    name: spell.name,
    ...(damage ? { damage } : {}),
    ...(type ? { type } : {}),
    ...(save ? { save } : {}),
    ...(attack !== undefined ? { attack } : {}),
    ...(aoe ? { aoe } : {}),
    ...(spell.secondary ? { secondary: spell.secondary } : {}),
    ...(concentration ? { concentration: true } : {}),
    ...(text ? { description: text } : {}),
  };
}

export function buildSpellLookup(
  spells: Array<{
    name: string;
    damage?: string;
    type?: string;
    save?: string;
    attack?: boolean;
    aoe?: { size: number; type: string };
    secondary?: { damage: string; type: string };
    concentration?: boolean;
    description?: string;
  }>,
): SpellLookup {
  const byName = new Map<string, SpellLookupData>();
  for (const spell of spells) {
    const enriched = enrichSpellData(spell);
    byName.set(spell.name.toLowerCase(), enriched);
    byName.set(normalizeSpellName(spell.name), enriched);
  }
  return (name: string) => {
    const cleaned = normalizeSpellName(name.replace(/\*+/g, ''));
    const direct = byName.get(cleaned) ?? byName.get(name.toLowerCase());
    if (direct) return direct;
    for (const [key, data] of byName) {
      if (key === cleaned || key.includes(cleaned) || cleaned.includes(key)) return data;
    }
    return undefined;
  };
}

function spellFromLookup(name: string, lookup?: SpellLookup): SpellLookupData | undefined {
  if (!lookup) return undefined;
  const cleaned = name.replace(/\*+/g, '').trim();
  const direct = lookup(cleaned);
  if (direct) return direct;
  return lookup(normalizeSpellName(cleaned));
}

function isSpellcastingName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes('spellcasting') || n.includes('innate');
}

function normalizeActionKey(name: string): string {
  return name.toLowerCase().replace(/\s*\([^)]*\)\s*$/g, '').trim();
}

/** When the same attack appears twice, keep the better entry — do not merge fields. */
function pickPreferredAction(a: ParsedAction, b: ParsedAction): ParsedAction {
  const aToHit = a.toHit ?? -99;
  const bToHit = b.toHit ?? -99;
  if (bToHit !== aToHit) {
    return (bToHit > aToHit ? b : a);
  }
  if (b.damages.length !== a.damages.length) {
    return b.damages.length > a.damages.length ? b : a;
  }
  return b.originalText.length > a.originalText.length ? b : a;
}

/** Drop duplicate weapon actions (e.g. two Greataxe entries) — keeps one, discards the other. */
/** Monster proficiency bonus by challenge rating (MM). */
export function proficiencyBonusFromCr(cr: number | string | undefined): number {
  const raw = typeof cr === 'string' ? parseFloat(cr.replace(/[^\d.]/g, '')) : cr;
  const n = Number.isFinite(raw) ? raw! : 0;
  if (n < 5) return 2;
  if (n < 9) return 3;
  if (n < 13) return 4;
  if (n < 17) return 5;
  if (n < 21) return 6;
  if (n < 25) return 7;
  if (n < 29) return 8;
  return 9;
}

/** When stat-block text omits "+X to hit", infer from ability scores + CR. */
export function inferMonsterAttackToHit(
  action: ParsedAction,
  abilities: AbilityScore[],
  proficiencyBonus: number,
): number | undefined {
  if (action.toHit !== undefined || action.damages.length === 0 || action.save) return action.toHit;

  const text = `${action.name} ${action.originalText}`.toLowerCase();
  const looksLikeAttack =
    action.range?.kind === 'melee'
    || action.range?.kind === 'ranged'
    || action.range?.kind === 'both'
    || /touch|ray|strike|slam|bite|claw|weapon attack|attack roll/i.test(text);
  if (!looksLikeAttack) return undefined;

  const str = abilities.find((a) => a.name === 'STR')?.mod ?? 0;
  const dex = abilities.find((a) => a.name === 'DEX')?.mod ?? 0;
  const isRanged =
    action.range?.kind === 'ranged'
    || (action.range?.rangeNormalFt != null && action.range.kind !== 'melee')
    || /\branged\b|\bray\b|range \d/i.test(text);
  return (isRanged ? dex : str) + proficiencyBonus;
}

export function deduplicateActions(actions: ParsedAction[]): ParsedAction[] {
  const byKey = new Map<string, ParsedAction>();
  const order: string[] = [];

  for (const action of actions) {
    if (action.isSpellcastingBlock || action.spellParent) {
      const key = action.spellParent
        ? `spell:${normalizeActionKey(action.name)}:${action.spellParent}`
        : `sc:${action.name}`;
      byKey.set(key, action);
      order.push(key);
      continue;
    }

    const key = normalizeActionKey(action.name);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, action);
      order.push(key);
    } else {
      byKey.set(key, pickPreferredAction(existing, action));
    }
  }

  return order.map((k) => {
    const action = byKey.get(k)!;
    return { ...action, damages: pruneDamageDuplicates(action.damages) };
  });
}

function expandSpellAction(
  spell: ActionSpell,
  parentName: string,
  globalSaveDC: string | undefined,
  globalToHit: string | undefined,
  lookup?: SpellLookup,
): ParsedAction | null {
  const data = spellFromLookup(spell.name, lookup);
  const displayName = data?.name ?? spell.name;
  const labelSuffix = spell.label ? ` (${spell.label})` : '';

  const damages: ActionDamage[] = [];
  const inlineDice = spell.dice?.replace(/\s+/g, '');
  if (inlineDice) damages.push({ dice: inlineDice, type: data?.type ?? 'damage' });
  else if (data?.damage) damages.push({ dice: data.damage, type: data?.type ?? 'damage' });
  if (data?.secondary) {
    damages.push({ dice: data.secondary.damage, type: data.secondary.type });
  }

  const hasSave = Boolean(data?.save && globalSaveDC);
  const isAttackSpell = Boolean(
    data?.attack || (globalToHit && damages.length > 0 && !hasSave),
  );

  if (!isAttackSpell && !hasSave && damages.length === 0) return null;

  const action: ParsedAction = {
    name: `${displayName}${labelSuffix}`,
    originalText: `Casts ${displayName}.`,
    section: 'actions',
    isTrait: false,
    damages,
    spells: [],
    spellParent: parentName,
  };

  const aoe = data?.aoe ?? spell.aoe;
  if (aoe) action.aoe = aoe;

  if (isAttackSpell && globalToHit) {
    action.toHit = parseInt(globalToHit, 10);
    action.range = buildActionRange('ranged', 5, 120);
  }
  if (hasSave && globalSaveDC && data?.save) {
    action.save = { dc: parseInt(globalSaveDC, 10), stat: data.save };
  }

  return action;
}

export function parseMonsterActions(description: string, lookup?: SpellLookup): ParsedAction[] {
  if (!description) return [];

  const text = description.replace(/\r\n/g, '\n');
  const globalSaveDC = (text.match(/spell save DC (\d+)/i) || [])[1];
  let globalToHit = (text.match(/([+-]\d+)\s*to\s*hit\s*with\s*spell/i) || [])[1];

  const lines = text.split('\n');
  const rawActions: Array<{
    name: string;
    text: string;
    fullText: string;
    section: ParsedAction['section'];
    isTrait: boolean;
  }> = [];

  let currentAction: (typeof rawActions)[number] | null = null;
  let section: ParsedAction['section'] = 'traits';
  const actionStartRegex = /^([A-Z][\w\s()\/\-''\u2013\u2014]{1,50})\.(.*)/;
  const ignoredHeaders = new Set([
    'Speed', 'Skills', 'Senses', 'Languages', 'Challenge', 'Saving Throws',
    'Damage Immunities', 'Condition Immunities', 'Damage Resistances', 'Damage Vulnerabilities',
  ]);
  let hasSeenActionHeader = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed === 'ACTIONS') { section = 'actions'; hasSeenActionHeader = true; continue; }
    if (trimmed === 'LEGENDARY ACTIONS') { section = 'legendary'; hasSeenActionHeader = true; continue; }
    if (trimmed === 'REACTIONS') { section = 'reactions'; hasSeenActionHeader = true; continue; }

    if (trimmed.includes('CREATURE CODEX') || trimmed.includes('TOME OF BEASTS') || /^\d+$/.test(trimmed)) {
      if (hasSeenActionHeader) {
        if (currentAction) rawActions.push(currentAction);
        break;
      }
      continue;
    }

    const startMatch = trimmed.match(actionStartRegex);
    if (startMatch) {
      const name = startMatch[1]!.trim();
      if (
        ignoredHeaders.has(name) ||
        name.startsWith('STR') || name.startsWith('DEX') ||
        name.includes('spell save DC') ||
        /^(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*\(/.test(name)
      ) {
        if (currentAction) {
          if (name.includes('spell save DC') || /^(Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma)\s*\(/.test(name)) {
            currentAction.text += ` ${trimmed}`;
            currentAction.fullText += `\n${trimmed}`;
            continue;
          }
          rawActions.push(currentAction);
          currentAction = null;
        }
        continue;
      }

      if (currentAction) rawActions.push(currentAction);
      currentAction = {
        name,
        text: startMatch[2]!.trim(),
        fullText: trimmed,
        section,
        isTrait: section === 'traits',
      };
    } else if (currentAction) {
      currentAction.text += ` ${trimmed}`;
      currentAction.fullText += `\n${trimmed}`;
    }
  }
  if (currentAction) rawActions.push(currentAction);

  const parsedActions: ParsedAction[] = rawActions.map((action) => {
    const details: ParsedAction = {
      name: action.name,
      originalText: action.fullText,
      section: action.section,
      isTrait: action.isTrait,
      damages: [],
      spells: [],
    };

    const attackToHit = parseActionToHit(action.fullText);
    if (attackToHit !== undefined) details.toHit = attackToHit;
    details.range = parseActionRange(action.fullText);

    const saveMatch = action.fullText.match(/DC\s*(\d+)\s*(\w+)\s*(?:saving\s*throw|save)/i);
    if (saveMatch) {
      details.save = { dc: parseInt(saveMatch[1]!, 10), stat: saveMatch[2]! };
    }

    const aoe = parseActionAoe(action.fullText);
    if (aoe) details.aoe = aoe;

    details.damages = parseActionDamages(action.fullText, details.range, action.name);

    if (isSpellcastingName(action.name)) {
      const spellDcMatch = action.fullText.match(/spell save DC (\d+)/i);
      if (spellDcMatch && !details.save) {
        details.save = { dc: parseInt(spellDcMatch[1]!, 10), stat: 'spell' };
      }
      const spellRegex = /([a-zA-Z\s]+?)\s*\(((\d+d\d+)(?:\s*[+-]\s*\d+)?)\)/g;
      let sMatch: RegExpExecArray | null;
      while ((sMatch = spellRegex.exec(action.fullText)) !== null) {
        const spellName = sMatch[1]!.trim();
        if (spellName === 'take' || spellName === 'plus' || spellName === 'Hit:') continue;
        const found = spellFromLookup(spellName, lookup);
        const entry: ActionSpell = {
          name: found?.name ?? spellName,
          dice: sMatch[2]!,
        };
        if (found?.aoe) entry.aoe = found.aoe;
        details.spells.push(entry);
      }

      const usageRegex = /(?:At will|at will|Constant|\d+\s*(?:\/|f)?\s*day(?:\s*each)?|Cantrips?(?:\s*\([^)]*\))?|\d+(?:st|nd|rd|th)?\s*level(?:\s*\([^)]*\))?)(?:[^:\n]*)?\s*:/gi;
      const usageIndices: Array<{ index: number; label: string }> = [];
      let uMatch: RegExpExecArray | null;
      while ((uMatch = usageRegex.exec(action.fullText)) !== null) {
        usageIndices.push({ index: uMatch.index, label: uMatch[0] });
      }

      for (let i = 0; i < usageIndices.length; i++) {
        const start = usageIndices[i]!.index + usageIndices[i]!.label.length;
        const end = i + 1 < usageIndices.length ? usageIndices[i + 1]!.index : action.fullText.length;
        const chunk = action.fullText.substring(start, end).replace(/\n/g, ' ').trim();
        const spells = chunk.split(',').map((s) => s.trim().replace(/\.$/, ''));

        for (const s of spells) {
          let spellName = s.replace(/\(.*\)/, '').replace(/\*+/g, '').trim();
          const cleanHeader = usageIndices[i]!.label.replace(':', '').trim().toLowerCase();
          if (!spellName || spellName.length <= 2) continue;
          if (spellName.toLowerCase().startsWith('following spells')) continue;
          if (spellName.toLowerCase() === cleanHeader) continue;
          if (details.spells.find((ex) => normalizeSpellName(ex.name) === normalizeSpellName(spellName))) continue;

          const found = spellFromLookup(spellName, lookup);
          const entry: ActionSpell = {
            name: found?.name ?? spellName,
            dice: found?.damage ?? null,
            label: usageIndices[i]!.label.split('(')[0]!.replace(':', '').trim(),
          };
          if (found?.aoe) entry.aoe = found.aoe;
          details.spells.push(entry);
        }
      }

      if (details.spells.length > 0 && details.damages.length === 0) {
        details.isSpellcastingBlock = true;
      }
    }

    return details;
  });

  if (!globalToHit) {
    const scBlock = parsedActions.find((a) => isSpellcastingName(a.name) && a.toHit !== undefined);
    if (scBlock?.toHit !== undefined) globalToHit = String(scBlock.toHit);
  }

  const newSpellActions: ParsedAction[] = [];
  for (const action of parsedActions) {
    if (!isSpellcastingName(action.name)) continue;
    const blockToHit = globalToHit ?? (action.toHit !== undefined ? String(action.toHit) : undefined);
    for (const spell of action.spells) {
      const expanded = expandSpellAction(
        spell,
        action.name,
        globalSaveDC,
        blockToHit,
        lookup,
      );
      if (expanded) newSpellActions.push(expanded);
    }
  }

  return deduplicateActions([...parsedActions, ...newSpellActions]);
}

export function getMonsterAbilities(
  description: string,
  stats?: Record<string, unknown>,
): AbilityScore[] {
  if (stats && Object.keys(stats).length > 0) return parseStatsObject(stats);
  return parseAbilities(description);
}
