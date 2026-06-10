import type {
  DdbLibraryItemSummary,
  DdbLibraryMonsterSummary,
  DdbLibrarySpellSummary,
} from '@grimoire/shared';
import type { OwlbearItem, OwlbearMonster, OwlbearSpell } from '@grimoire/shared';
import { normalizeAbilityName } from '@grimoire/shared';
import { joinSections, stripDdbHtml } from './ddbHtml';
import { monsterHasFullStatBlock, monsterHasImportableStatBlock } from './ddbMonsterFetch';
import {
  formatChallengeRatingValue,
  resolveMonsterSourceLabel,
  type DdbCatalog,
} from './ddbSources';

const SIZE_NAMES: Record<number, string> = {
  1: 'Tiny',
  2: 'Small',
  3: 'Medium',
  4: 'Large',
  5: 'Huge',
  6: 'Gargantuan',
};

function pickNumber(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (v == null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function sourceLabelFromEntries(sources: unknown): string {
  if (!Array.isArray(sources) || sources.length === 0) return 'D&D Beyond';
  const names = sources
    .map((s) => {
      if (!s || typeof s !== 'object') return '';
      const o = s as Record<string, unknown>;
      return String(o.sourceName ?? o.name ?? o.label ?? '').trim();
    })
    .filter(Boolean);
  return names.length ? [...new Set(names)].join(', ') : 'D&D Beyond';
}

/** True when a DDB entity belongs to the given source book id. */
export function entryHasSourceId(raw: Record<string, unknown>, sourceId: number): boolean {
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const buckets = [raw.sources, def.sources, raw.sourceIds, def.sourceIds];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object') continue;
      const o = entry as Record<string, unknown>;
      const id = Number(o.sourceId ?? o.id);
      if (id === sourceId) return true;
    }
  }
  return false;
}

function entityId(raw: Record<string, unknown>): number | undefined {
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  return pickNumber(
    def.id,
    raw.id,
    raw.definitionId,
    def.definitionId,
    raw.entityTypeId,
    def.entityTypeId,
  );
}

export { entityId as ddbEntityId };

function formatAbilityScores(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  const byName = new Map<string, number>();
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const name = normalizeAbilityName(o.abilityId ?? o.id ?? o.name ?? o.statId);
    const value = pickNumber(o.value, o.score);
    if (value != null) byName.set(name, value);
  }
  const order = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
  const scores = order.map((k) => byName.get(k));
  if (scores.every((v) => v == null)) return '';
  const mods = scores.map((s) => {
    if (s == null) return '—';
    const mod = Math.floor((s - 10) / 2);
    return mod >= 0 ? `+${mod}` : String(mod);
  });
  return `STR DEX CON INT WIS CHA\n${scores.map((s) => s ?? '—').join(' ')} (${mods.join(' ')})`;
}

function parseAcFromText(text: string): number | undefined {
  const m = text.match(/(?:Armor Class|AC)\s*(?:\(.*?\))?\s*(\d+)/i);
  if (!m?.[1]) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseHpFromText(text: string): number | undefined {
  const m = text.match(/Hit Points\s+(\d+)/i);
  if (!m?.[1]) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function pickRichText(obj: Record<string, unknown>, keys: string[]): string {
  let best = '';
  for (const key of keys) {
    const text = stripDdbHtml(obj[key]);
    if (text.length > best.length) best = text;
  }
  return best;
}

function formatRange(range: unknown): string {
  if (!range || typeof range !== 'object') return '';
  const r = range as Record<string, unknown>;
  const aoe = r.aoeType && r.aoeSize ? `${r.aoeSize}-ft ${String(r.aoeType).toLowerCase()}` : '';
  const normal = String(r.range ?? r.rangeValue ?? r.origin ?? '').trim();
  const unit = String(r.rangeUnit ?? r.unit ?? 'ft').trim();
  if (aoe) return aoe;
  if (normal && unit) return `${normal} ${unit}`;
  return normal || unit;
}

function formatActivation(activation: unknown): string {
  if (!activation || typeof activation !== 'object') return '';
  const a = activation as Record<string, unknown>;
  const time = pickNumber(a.activationTime, a.time);
  const type = String(a.activationTypeName ?? a.activationType ?? a.type ?? '').trim();
  if (time != null && type) return `${time} ${type}`.trim();
  return type || (time != null ? String(time) : '');
}

function formatComponents(def: Record<string, unknown>): string {
  const parts: string[] = [];
  if (def.componentsDescription) {
    return stripDdbHtml(def.componentsDescription);
  }
  if (def.verbal) parts.push('V');
  if (def.somatic) parts.push('S');
  if (def.material) parts.push('M');
  const material = stripDdbHtml(def.materialsDescription ?? def.materialDescription);
  if (material) return `${parts.join(', ')} (${material})`;
  return parts.join(', ');
}

function formatAtHigherLevels(def: Record<string, unknown>): string {
  const direct = pickRichText(def, ['higherLevelDescription', 'atHigherLevelsDescription', 'higherLevelsDescription']);
  if (direct) return direct;
  const bucket = def.atHigherLevels ?? def.higherLevelDefinitions;
  if (!Array.isArray(bucket)) return '';
  return bucket.map((entry) => {
    if (!entry || typeof entry !== 'object') return stripDdbHtml(entry);
    const o = entry as Record<string, unknown>;
    const level = pickNumber(o.level, o.slotLevel);
    const text = stripDdbHtml(o.description ?? o.details ?? o.snippet);
    return level != null && text ? `At ${level}${level === 1 ? 'st' : level === 2 ? 'nd' : level === 3 ? 'rd' : 'th'} level: ${text}` : text;
  }).filter(Boolean).join('\n');
}

function formatItemProperties(def: Record<string, unknown>): string {
  const lines: string[] = [];
  const type = String(def.type ?? def.filterType ?? '').trim();
  if (type) lines.push(`Type: ${type}`);
  const rarity = String(def.rarity ?? def.rarityName ?? '').trim();
  if (rarity) lines.push(`Rarity: ${rarity}`);
  if (def.requiresAttunement || def.isAttunable) {
    lines.push(`Requires Attunement${def.attunementDescription ? `: ${stripDdbHtml(def.attunementDescription)}` : ''}`);
  }
  const weight = pickNumber(def.weight, def.weightValue);
  if (weight != null) lines.push(`Weight: ${weight} lb.`);
  const cost = pickNumber(def.cost, def.value);
  if (cost != null) lines.push(`Cost: ${cost} gp`);
  if (Array.isArray(def.properties)) {
    const props = def.properties
      .map((p) => {
        if (!p || typeof p !== 'object') return String(p ?? '').trim();
        const o = p as Record<string, unknown>;
        return String(o.name ?? o.description ?? o.label ?? '').trim();
      })
      .filter(Boolean);
    if (props.length) lines.push(`Properties: ${props.join(', ')}`);
  }
  return lines.join('\n');
}

function proficiencyBonusFromMonsterCr(cr: string): number {
  const cleaned = cr.trim();
  let n = 0;
  if (cleaned.includes('/')) {
    const [a, b] = cleaned.split('/');
    const num = parseInt(a ?? '', 10);
    const den = parseInt(b ?? '', 10);
    n = Number.isFinite(num) && Number.isFinite(den) && den > 0 ? num / den : 0;
  } else {
    n = parseFloat(cleaned.replace(/[^\d.]/g, ''));
  }
  if (!Number.isFinite(n)) n = 0;
  if (n < 5) return 2;
  if (n < 9) return 3;
  if (n < 13) return 4;
  if (n < 17) return 5;
  if (n < 21) return 6;
  if (n < 25) return 7;
  if (n < 29) return 8;
  return 9;
}

function abilityModsFromMonster(raw: Record<string, unknown>): Record<string, number> {
  const stats = abilityStatsFromRaw(raw);
  const mods: Record<string, number> = {};
  for (const [key, score] of Object.entries(stats)) {
    mods[key.toUpperCase()] = Math.floor((score - 10) / 2);
  }
  return mods;
}

function parseToHitFromActionText(text: string): number | undefined {
  if (!text) return undefined;
  const patterns = [
    /(?:Melee|Ranged)\s+Attack\s+Roll[\s.:,]*\+?\s*([+-]?\d+)/i,
    /Attack\s+Roll[\s.:,]*\+?\s*([+-]?\d+)/i,
    /(?:Melee|Ranged|Spell|Weapon)\s+Attack[\s.:,]*\+?\s*([+-]?\d+)\s*to\s*hit/i,
    /([+-]\d+)\s*to\s*hit/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function textHasAttackBonus(text: string): boolean {
  return /\+\s*\d+\s*to\s*hit|to\s*hit[,.]?\s*\+?\s*\d+|attack\s+roll[:\s]+\+?\s*\d+/i.test(text);
}

function collectMonsterActionBlocks(raw: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const buckets = [
    raw.actions,
    raw.monsterActions,
    raw.standardActions,
    (raw.actionSections as Record<string, unknown> | undefined)?.actions,
  ];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    out.push(...bucket);
  }
  return out;
}

function extractMonsterActionToHit(
  o: Record<string, unknown>,
  raw: Record<string, unknown>,
  catalog: DdbCatalog | undefined,
  descText: string,
): number | undefined {
  const attack = (o.attack && typeof o.attack === 'object' ? o.attack : {}) as Record<string, unknown>;
  const def = (o.definition && typeof o.definition === 'object' ? o.definition : {}) as Record<string, unknown>;

  const direct = pickNumber(
    o.attackBonus,
    o.toHit,
    o.attackModifier,
    o.attackStatValue,
    o.fixedToHit,
    o.attackMod,
    attack.attackBonus,
    attack.attackModifier,
    attack.toHit,
    attack.fixedToHit,
    def.attackBonus,
    def.attackModifier,
    def.toHit,
  );
  if (direct != null) return direct;

  const abilityMod = pickNumber(
    o.abilityModifier,
    o.statModifier,
    o.attackStatModifier,
    attack.abilityModifier,
    attack.statModifier,
  );
  const cr = catalog
    ? resolveMonsterCr(raw, catalog.challengeRatingById)
    : resolveMonsterCr(raw, new Map());
  const prof = pickNumber(o.proficiencyBonus, raw.proficiencyBonus) ?? proficiencyBonusFromMonsterCr(cr);

  if (abilityMod != null) return abilityMod + prof;

  const fromText = parseToHitFromActionText(descText);
  if (fromText != null) return fromText;

  const name = String(o.name ?? o.title ?? '').toLowerCase();
  const combined = `${name} ${descText}`.toLowerCase();
  const damage = o.dice
    ?? o.damageDice
    ?? (typeof o.damage === 'object' ? (o.damage as Record<string, unknown>).dice : o.damage)
    ?? o.fixedDamage
    ?? attack.damage
    ?? def.damage;
  const looksLikeAttack =
    Boolean(damage)
    || /touch|ray|strike|slam|bite|claw|weapon attack|attack roll/i.test(combined);
  if (!looksLikeAttack) return undefined;

  const mods = abilityModsFromMonster(raw);
  const str = mods.STR ?? 0;
  const dex = mods.DEX ?? 0;
  const ranged = /\branged\b|\bray\b|range\s+\d/i.test(combined);
  return (ranged ? dex : str) + prof;
}

function formatAttackDetails(
  o: Record<string, unknown>,
  raw?: Record<string, unknown>,
  catalog?: DdbCatalog,
  descText?: string,
): string {
  const parts: string[] = [];
  const description = descText ?? pickRichText(o, [
    'description',
    'text',
    'snippet',
    'attackNotes',
    'actionDescription',
    'details',
  ]);
  const toHit = raw
    ? extractMonsterActionToHit(o, raw, catalog, description)
    : pickNumber(o.attackBonus, o.toHit, o.attackModifier, o.attackStatValue);
  if (toHit != null) parts.push(`${toHit >= 0 ? '+' : ''}${toHit} to hit`);

  const attack = (o.attack && typeof o.attack === 'object' ? o.attack : {}) as Record<string, unknown>;
  const def = (o.definition && typeof o.definition === 'object' ? o.definition : {}) as Record<string, unknown>;
  const reach = o.reach ?? o.range ?? o.attackRange ?? o.rangeDescription ?? attack.range ?? def.range;
  if (reach) parts.push(String(reach).trim());

  const damage = o.dice
    ?? o.damageDice
    ?? (typeof o.damage === 'object' ? (o.damage as Record<string, unknown>).dice : o.damage)
    ?? o.fixedDamage
    ?? attack.damage
    ?? attack.dice
    ?? def.damage
    ?? def.dice;
  if (damage) parts.push(`${stripDdbHtml(damage)} damage`);

  const saveDc = pickNumber(o.saveDc, o.dc, o.spellSaveDc, attack.saveDc, def.saveDc);
  const saveStat = String(o.saveStatName ?? o.saveStat ?? o.saveAbilityName ?? attack.saveStat ?? '').trim();
  if (saveDc != null) parts.push(`DC ${saveDc}${saveStat ? ` ${saveStat}` : ''} save`);

  return parts.join(', ');
}

function formatActionEntry(
  block: unknown,
  raw?: Record<string, unknown>,
  catalog?: DdbCatalog,
): string {
  if (!block || typeof block !== 'object') return stripDdbHtml(block);
  const o = block as Record<string, unknown>;
  const name = String(o.name ?? o.title ?? '').trim();
  const desc = pickRichText(o, [
    'description',
    'text',
    'snippet',
    'attackNotes',
    'actionDescription',
    'details',
  ]);
  const attack = formatAttackDetails(o, raw, catalog, desc);
  const chunks = [desc, attack].filter(Boolean);
  if (name && chunks.length) return `${name}. ${chunks.join(' ')}`;
  return name || chunks.join(' ');
}

function formatNamedBlocks(
  title: string,
  blocks: unknown,
  raw?: Record<string, unknown>,
  catalog?: DdbCatalog,
): string {
  if (!Array.isArray(blocks) || blocks.length === 0) return '';
  const lines = blocks.map((block) => formatActionEntry(block, raw, catalog)).filter(Boolean);
  if (!lines.length) return '';
  return `${title}\n${lines.join('\n')}`;
}

function appendMonsterActionSection(
  parts: string[],
  title: string,
  blocks: unknown,
  descriptionHtml: unknown,
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
): void {
  const structured = formatNamedBlocks(title, blocks, raw, catalog);
  const html = stripDdbHtml(descriptionHtml);

  if (structured && html && textHasAttackBonus(html) && !textHasAttackBonus(structured)) {
    appendSection(parts, title);
    parts.push(html);
    return;
  }
  if (structured) {
    appendSection(parts, structured);
    return;
  }
  if (html) {
    appendSection(parts, title);
    parts.push(html);
  }
}

function buildSpellDescription(def: Record<string, unknown>): string {
  const sections: Array<{ title: string; body: unknown }> = [];
  const meta: string[] = [];
  const casting = formatActivation(def.activation ?? def.castingTime);
  if (casting) meta.push(`Casting Time: ${casting}`);
  const range = formatRange(def.range);
  if (range) meta.push(`Range: ${range}`);
  const duration = stripDdbHtml(def.duration ?? def.durationDescription);
  if (duration) meta.push(`Duration: ${duration}`);
  const components = formatComponents(def);
  if (components) meta.push(`Components: ${components}`);
  if (def.ritual) meta.push('Ritual');
  if (def.concentration) meta.push('Concentration');
  if (meta.length) sections.push({ title: 'Casting', body: meta.join('\n') });

  const description = pickRichText(def, [
    'description',
    'fullDescription',
    'details',
    'snippet',
    'specialDescription',
  ]);
  if (description) sections.push({ title: 'Description', body: description });

  const higher = formatAtHigherLevels(def);
  if (higher) sections.push({ title: 'At Higher Levels', body: higher });

  return joinSections(sections);
}

function buildItemTexts(def: Record<string, unknown>, name: string): { description: string; flavor: string; details: string } {
  const flavor = pickRichText(def, ['snippet', 'flavor', 'summary']);
  const properties = formatItemProperties(def);
  const details = pickRichText(def, [
    'description',
    'fullDescription',
    'details',
    'specialDescription',
    'notesDescription',
  ]);
  const description = joinSections([
    ...(properties ? [{ title: 'Properties', body: properties }] : []),
    ...(details ? [{ title: 'Description', body: details }] : []),
  ]) || flavor || name;
  return {
    description,
    flavor,
    details: details || description,
  };
}

const DDB_STAT_NAMES: Record<number, string> = {
  1: 'STR',
  2: 'DEX',
  3: 'CON',
  4: 'INT',
  5: 'WIS',
  6: 'CHA',
};

const DEFAULT_MOVEMENT_NAMES: Record<number, string> = {
  1: 'walk',
  2: 'burrow',
  3: 'climb',
  4: 'fly',
  5: 'swim',
};

function formatAbilityMod(score: number): string {
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : String(mod);
}

function appendSection(parts: string[], body: string): void {
  const text = body.trim();
  if (!text) return;
  if (parts.length > 0) parts.push('');
  parts.push(text);
}

function formatMonsterSpeed(raw: Record<string, unknown>, catalog?: DdbCatalog): string {
  const movements = raw.movements;
  if (Array.isArray(movements) && movements.length > 0) {
    const movementNames = catalog?.movements ?? new Map(Object.entries(DEFAULT_MOVEMENT_NAMES).map(([k, v]) => [Number(k), v]));
    const speeds = movements.map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const mv = entry as Record<string, unknown>;
      const speed = pickNumber(mv.speed);
      if (speed == null) return '';
      const movementId = Number(mv.movementId);
      const name = (movementNames.get(movementId) ?? 'walk').toLowerCase();
      return name === 'walk' ? `${speed} ft.` : `${name} ${speed} ft.`;
    }).filter(Boolean);
    if (speeds.length) return speeds.join(', ');
  }

  const speed = stripDdbHtml(raw.speed);
  const notes = stripDdbHtml(raw.speedNotes);
  return `${speed} ${notes}`.trim();
}

function formatMonsterAbilityLine(raw: Record<string, unknown>): string {
  const stats = raw.stats;
  if (Array.isArray(stats) && stats.length > 0) {
    return [...stats]
      .sort((a, b) => Number((a as Record<string, unknown>).statId) - Number((b as Record<string, unknown>).statId))
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return '';
        const o = entry as Record<string, unknown>;
        const statId = Number(o.statId);
        const value = pickNumber(o.value, o.score);
        if (value == null) return '';
        const name = DDB_STAT_NAMES[statId] ?? String(o.name ?? '???');
        return `${name} ${value} (${formatAbilityMod(value)})`;
      })
      .filter(Boolean)
      .join(' ');
  }

  const abilities = formatAbilityScores(raw.abilities ?? raw.statAttributes);
  if (!abilities) return '';
  return abilities
    .split('\n')
    .slice(1)
    .join(' ')
    .replace(/\(\+/g, '(+')
    .replace(/\(\-/g, '(-')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatMonsterSavingThrows(raw: Record<string, unknown>): string {
  const saves = raw.savingThrows;
  if (Array.isArray(saves) && saves.length > 0) {
    return saves.map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const o = entry as Record<string, unknown>;
      const statId = Number(o.statId);
      const bonus = pickNumber(o.bonusModifier, o.value);
      if (bonus == null) return '';
      const name = DDB_STAT_NAMES[statId] ?? String(o.name ?? '???');
      return `${name} ${bonus >= 0 ? '+' : ''}${bonus}`;
    }).filter(Boolean).join(', ');
  }
  return stripDdbHtml(raw.savingThrowsDescription);
}

function formatMonsterSkills(raw: Record<string, unknown>): string {
  const skillsHtml = stripDdbHtml(raw.skillsHtml);
  if (skillsHtml) return skillsHtml;
  return stripDdbHtml(raw.skillsDescription);
}

function formatMonsterSenses(raw: Record<string, unknown>, catalog?: DdbCatalog): string {
  const senses = raw.senses;
  const parts: string[] = [];
  if (Array.isArray(senses) && senses.length > 0) {
    const senseNames = catalog?.senses ?? new Map<number, string>();
    for (const entry of senses) {
      if (!entry || typeof entry !== 'object') continue;
      const o = entry as Record<string, unknown>;
      const senseId = Number(o.senseId ?? o.id);
      const name = senseNames.get(senseId) ?? String(o.name ?? '').trim();
      const notes = String(o.notes ?? o.range ?? '').trim();
      if (name && notes) parts.push(`${name} ${notes}`);
      else if (name) parts.push(name);
      else if (notes) parts.push(notes);
    }
  } else {
    const sensesHtml = stripDdbHtml(raw.sensesHtml);
    if (sensesHtml) parts.push(sensesHtml);
    else {
      const sensesDesc = stripDdbHtml(raw.sensesDescription);
      if (sensesDesc) parts.push(sensesDesc);
    }
  }

  const passive = pickNumber(raw.passivePerception);
  if (passive != null && passive > 0) parts.push(`passive Perception ${passive}`);
  return parts.join(', ');
}

function formatMonsterLanguages(raw: Record<string, unknown>): string {
  const languages = raw.languages;
  if (Array.isArray(languages) && languages.length > 0) {
    const names = languages.map((entry) => {
      if (!entry || typeof entry !== 'object') return String(entry ?? '').trim();
      const o = entry as Record<string, unknown>;
      return String(o.name ?? o.label ?? o.languageName ?? '').trim();
    }).filter(Boolean);
    if (names.length) {
      const note = String(raw.languageNote ?? '').trim();
      return note ? `${names.join(', ')} ${note}` : names.join(', ');
    }
  }

  const languageDescription = stripDdbHtml(raw.languageDescription ?? raw.languagesDescription);
  const note = String(raw.languageNote ?? '').trim();
  if (languageDescription && note) return `${languageDescription} ${note}`;
  return languageDescription || note;
}

function formatMonsterChallengeLine(
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
): string {
  const crDesc = stripDdbHtml(raw.challengeRatingDescription);
  if (crDesc) return crDesc.startsWith('Challenge') ? crDesc : `Challenge ${crDesc}`;

  if (!catalog) return '';
  const cr = resolveMonsterCr(raw, catalog.challengeRatingById);
  if (cr === '?') return '';
  const crId = Number(raw.challengeRatingId);
  const xp = catalog.challengeRatingXpById.get(crId);
  return xp != null ? `Challenge ${cr} (${xp.toLocaleString()} XP)` : `Challenge ${cr}`;
}

function abilityStatsFromRaw(raw: Record<string, unknown>): Record<string, number> {
  const out: Record<string, number> = {};
  const stats = raw.stats;
  if (!Array.isArray(stats)) return out;
  const keys = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
  for (const entry of stats) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const statId = Number(o.statId);
    const value = pickNumber(o.value, o.score);
    if (statId >= 1 && statId <= 6 && value != null) out[keys[statId - 1]!] = value;
  }
  return out;
}

function monsterTypeLine(raw: Record<string, unknown>, catalog?: DdbCatalog): string {
  const size = String(raw.sizeName ?? SIZE_NAMES[Number(raw.sizeId)] ?? 'Medium');
  const typeId = Number(raw.typeId);
  const type = catalog?.monsterTypes.get(typeId)
    ?? String(raw.typeName ?? raw.type ?? 'creature');
  const alignmentId = Number(raw.alignmentId);
  const alignment = catalog?.alignments.get(alignmentId)
    ?? String(raw.alignmentName ?? raw.alignment ?? 'unaligned').trim();
  return `${size} ${type}${alignment ? `, ${alignment.toLowerCase()}` : ''}`;
}

function ddbPrimaryStatBlockText(raw: Record<string, unknown>): string {
  for (const key of [
    'characteristicsDescription',
    'statBlockDescription',
    'statBlockHtml',
    'fullDescription',
  ]) {
    const text = stripDdbHtml(raw[key]);
    if (text.length >= 40) return text;
  }
  return '';
}

function looksLikeDdbFullStatBlock(text: string): boolean {
  if (text.length < 100) return false;
  const lower = text.toLowerCase();
  const hasCombat = /armor class|hit points|challenge/i.test(lower);
  const hasDepth =
    text.length >= 240
    || /actions|traits|legendary|multiattack|spellcasting|reactions|bonus actions/i.test(lower)
    || (/str\s*\d+|strength\s*\d+/i.test(lower) && /dex\s*\d+|dexterity\s*\d+/i.test(lower));
  return hasCombat && hasDepth;
}

function appendSectionsIfMissing(base: string, sections: string[]): string {
  const lower = base.toLowerCase();
  const extra: string[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    const titleLine = trimmed.split('\n')[0]?.trim().toLowerCase() ?? '';
    if (titleLine && lower.includes(titleLine)) continue;
    if (trimmed.length > 48 && base.includes(trimmed.slice(0, 48))) continue;
    extra.push(trimmed);
  }
  if (extra.length === 0) return base;
  return `${base}\n\n${extra.join('\n\n')}`.trim();
}

function appendMonsterActionSectionsOnly(
  parts: string[],
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
): void {
  appendMonsterActionSection(
    parts,
    'ACTIONS',
    collectMonsterActionBlocks(raw),
    raw.actionsDescription,
    raw,
    catalog,
  );
  appendMonsterActionSection(
    parts,
    'Bonus Actions',
    raw.bonusActions,
    raw.bonusActionsDescription,
    raw,
    catalog,
  );
  appendMonsterActionSection(
    parts,
    'REACTIONS',
    raw.reactions,
    raw.reactionsDescription,
    raw,
    catalog,
  );
  appendMonsterActionSection(
    parts,
    'LEGENDARY ACTIONS',
    raw.legendaryActions,
    raw.legendaryActionsDescription,
    raw,
    catalog,
  );
  appendMonsterActionSection(
    parts,
    'MYTHIC ACTIONS',
    raw.mythicActions,
    raw.mythicActionsDescription,
    raw,
    catalog,
  );
  const lair = stripDdbHtml(raw.lairDescription);
  if (lair) appendSection(parts, `Lair Actions\n${lair}`);
}

function monsterHasCombatFields(raw: Record<string, unknown>): boolean {
  const ac = pickNumber(raw.armorClass, raw.ac);
  const hp = pickNumber(raw.averageHitPoints, raw.hitPoints, raw.hp);
  return ac != null && ac > 0 && hp != null && hp > 0;
}

function buildStructuredMonsterDescription(
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
): string {
  const parts: string[] = [];

  const characteristics = stripDdbHtml(raw.characteristicsDescription);
  const characteristicsIsStatBlock = characteristics
    && (looksLikeDdbFullStatBlock(characteristics)
      || /armor class|hit points/i.test(characteristics));
  const hasCombatNumbers = monsterHasCombatFields(raw);

  if (characteristics) {
    if (characteristicsIsStatBlock && !hasCombatNumbers) {
      parts.push(characteristics);
    } else if (!characteristicsIsStatBlock && !hasCombatNumbers) {
      parts.push(characteristics);
    }
  }

  const typeLine = monsterTypeLine(raw, catalog);
  if (typeLine && !characteristicsIsStatBlock) parts.push(typeLine);

  const ac = pickNumber(raw.armorClass, raw.ac);
  const acDesc = stripDdbHtml(raw.armorClassDescription);
  if (ac != null && ac > 0) parts.push(`Armor Class ${ac}${acDesc ? ` (${acDesc})` : ''}`);

  const hp = pickNumber(raw.averageHitPoints, raw.hitPoints, raw.hp);
  const hpDice = raw.hitPointDice as Record<string, unknown> | undefined;
  const diceStr = hpDice ? String(hpDice.diceString ?? '').trim() : '';
  if (hp != null && hp > 0) {
    parts.push(`Hit Points ${hp}${diceStr && diceStr !== 'd0' ? ` (${diceStr})` : ''}`);
  }

  const speed = formatMonsterSpeed(raw, catalog);
  if (speed) parts.push(`Speed ${speed}`);

  const abilities = formatMonsterAbilityLine(raw);
  if (abilities) parts.push(abilities);

  const saves = formatMonsterSavingThrows(raw);
  if (saves) parts.push(`Saving Throws ${saves}`);

  const skills = formatMonsterSkills(raw);
  if (skills) parts.push(`Skills ${skills}`);

  for (const [label, key] of [
    ['Damage Vulnerabilities', 'damageVulnerabilitiesDescription'],
    ['Damage Resistances', 'damageResistancesDescription'],
    ['Damage Immunities', 'damageImmunitiesDescription'],
    ['Condition Immunities', 'conditionImmunitiesDescription'],
  ] as const) {
    const text = stripDdbHtml(raw[key] ?? raw[`${key.replace('Description', 'Html')}`]);
    if (text) parts.push(`${label} ${text}`);
  }

  const conditionHtml = stripDdbHtml(raw.conditionImmunitiesHtml);
  if (conditionHtml && !parts.some((p) => p.startsWith('Condition Immunities'))) {
    parts.push(`Condition Immunities ${conditionHtml}`);
  }

  const senses = formatMonsterSenses(raw, catalog);
  if (senses) parts.push(`Senses ${senses}`);

  const languages = formatMonsterLanguages(raw);
  if (languages) parts.push(`Languages ${languages}`);

  const challenge = formatMonsterChallengeLine(raw, catalog);
  if (challenge) parts.push(challenge);

  const traits = stripDdbHtml(raw.specialTraitsDescription);
  if (traits) appendSection(parts, traits);

  const traitsFromBlocks = formatNamedBlocks('', raw.specialAbilities ?? raw.traits ?? raw.traitSections);
  if (traitsFromBlocks) appendSection(parts, traitsFromBlocks.replace(/^\n/, ''));

  const spellcasting = formatNamedBlocks('', raw.spellcasting ?? raw.spells);
  if (spellcasting) appendSection(parts, spellcasting);

  appendMonsterActionSection(
    parts,
    'ACTIONS',
    collectMonsterActionBlocks(raw),
    raw.actionsDescription,
    raw,
    catalog,
  );

  appendMonsterActionSection(
    parts,
    'Bonus Actions',
    raw.bonusActions,
    raw.bonusActionsDescription,
    raw,
    catalog,
  );

  appendMonsterActionSection(
    parts,
    'REACTIONS',
    raw.reactions,
    raw.reactionsDescription,
    raw,
    catalog,
  );

  appendMonsterActionSection(
    parts,
    'LEGENDARY ACTIONS',
    raw.legendaryActions,
    raw.legendaryActionsDescription,
    raw,
    catalog,
  );

  appendMonsterActionSection(
    parts,
    'MYTHIC ACTIONS',
    raw.mythicActions,
    raw.mythicActionsDescription,
    raw,
    catalog,
  );

  const lair = stripDdbHtml(raw.lairDescription);
  if (lair) appendSection(parts, `Lair Actions\n${lair}`);

  const structured = parts.join('\n').trim();
  if (structured.length >= 120) return structured;

  if (structured.length < 40 && characteristics && !structured.includes(characteristics.slice(0, 32))) {
    return characteristics + (structured ? `\n\n${structured}` : '');
  }

  const htmlBlock = pickRichText(raw, [
    'statBlockDescription',
    'fullDescription',
    'description',
    'statBlockHtml',
    'actionsDescription',
    'specialTraitsDescription',
    'characteristicsDescription',
  ]);

  if (htmlBlock.length > structured.length + 40) {
    return structured ? `${structured}\n\n${htmlBlock}` : htmlBlock;
  }
  return structured || htmlBlock || '';
}

export function ddbMonsterHasUsableDescription(
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
): boolean {
  return ddbMonsterCanImport(raw, catalog);
}

export function ddbMonsterCanImport(
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
): boolean {
  const name = String(raw.name ?? '').trim();
  if (!name) return false;
  if (monsterHasFullStatBlock(raw)) return true;

  const desc = buildMonsterDescription(raw, catalog).trim();
  if (desc.length >= 200) return true;

  const lower = desc.toLowerCase();
  if (desc.length >= 80 && /actions|traits|multiattack|legendary/i.test(lower)) return true;
  if (desc.length >= 50 && /armor class \d+/i.test(lower) && /(?:hit points|hp) \d+/i.test(lower)) {
    return true;
  }
  if (monsterHasImportableStatBlock(raw) && desc.length >= 40) return true;

  return false;
}

function buildMonsterDescription(raw: Record<string, unknown>, catalog?: DdbCatalog): string {
  const ddbPrimary = ddbPrimaryStatBlockText(raw);

  if (ddbPrimary && looksLikeDdbFullStatBlock(ddbPrimary)) {
    const extras: string[] = [];
    appendMonsterActionSectionsOnly(extras, raw, catalog);
    return appendSectionsIfMissing(ddbPrimary, extras);
  }

  const structured = buildStructuredMonsterDescription(raw, catalog);
  if (structured.length > ddbPrimary.length + 60) return structured;
  if (ddbPrimary && ddbPrimary.length >= 80) {
    return appendSectionsIfMissing(ddbPrimary, [structured]);
  }
  if (structured) return structured;
  if (ddbPrimary) return ddbPrimary;

  const fallback = pickRichText(raw, [
    'statBlockDescription',
    'statBlockHtml',
    'fullDescription',
    'description',
    'actionsDescription',
    'specialTraitsDescription',
    'characteristicsDescription',
  ]);
  return fallback || '';
}

export function resolveMonsterCr(
  raw: Record<string, unknown>,
  challengeRatingById: Map<number, number>,
): string {
  const crId = Number(raw.challengeRatingId);
  if (Number.isFinite(crId) && challengeRatingById.has(crId)) {
    return formatChallengeRatingValue(challengeRatingById.get(crId)!);
  }

  const direct = raw.challengeRating ?? raw.cr;
  if (direct != null && direct !== '') {
    const text = String(direct).trim();
    if (text && text !== '0') return text;
  }

  const desc = stripDdbHtml(raw.challengeRatingDescription);
  const match = desc.match(/(?:challenge\s*)?(?:CR\s*)?(\d+(?:\/\d+)?)/i);
  if (match?.[1]) return match[1];

  return '?';
}

export function normalizeDdbMonsterSummary(
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
  preferredSourceId?: number,
): DdbLibraryMonsterSummary | null {
  const id = pickNumber(raw.id);
  const name = String(raw.name ?? '').trim();
  if (!id || !name) return null;
  const cr = catalog
    ? resolveMonsterCr(raw, catalog.challengeRatingById)
    : resolveMonsterCr(raw, new Map());
  const source = catalog
    ? resolveMonsterSourceLabel(raw, catalog.sourceNames, preferredSourceId)
    : sourceLabelFromEntries(raw.sources);
  return {
    ddbId: id,
    name,
    cr,
    hp: pickNumber(raw.averageHitPoints, raw.hitPoints, raw.hp),
    ac: pickNumber(raw.armorClass, raw.ac),
    source,
    imageUrl: String(raw.largeAvatarUrl ?? raw.basicAvatarUrl ?? raw.avatarUrl ?? '').trim() || undefined,
    isHomebrew: Boolean(raw.isHomebrew),
  };
}

export function normalizeDdbMonsterToCompendium(
  raw: Record<string, unknown>,
  catalog?: DdbCatalog,
  preferredSourceId?: number,
): OwlbearMonster | null {
  const summary = normalizeDdbMonsterSummary(raw, catalog, preferredSourceId);
  if (!summary) return null;
  const description = buildMonsterDescription(raw, catalog);
  const abilityStats = abilityStatsFromRaw(raw);
  const stats: Record<string, unknown> = {
    ddbMonsterId: summary.ddbId,
    ...abilityStats,
  };
  const resist = stripDdbHtml(raw.damageResistancesDescription);
  const immune = stripDdbHtml(raw.damageImmunitiesDescription);
  const vuln = stripDdbHtml(raw.damageVulnerabilitiesDescription);
  if (resist) stats.damageResistances = resist;
  if (immune) stats.damageImmunities = immune;
  if (vuln) stats.damageVulnerabilities = vuln;

  const hpRaw = summary.hp ?? parseHpFromText(description);
  const acRaw = summary.ac ?? parseAcFromText(description);
  const hp = hpRaw != null && hpRaw > 0 ? hpRaw : 1;
  const ac = acRaw != null && acRaw > 0 ? acRaw : 10;

  return {
    name: summary.name,
    type: monsterTypeLine(raw, catalog),
    source: summary.source ?? 'D&D Beyond',
    hp,
    ac,
    cr: summary.cr,
    description: description || summary.name,
    ...(summary.imageUrl ? { image: summary.imageUrl } : {}),
    stats: {
      ...stats,
      ...(hpRaw == null && description ? { hpEstimated: true } : {}),
      ...(acRaw == null && description ? { acEstimated: true } : {}),
    },
  };
}

export function normalizeDdbItemSummary(raw: Record<string, unknown>): DdbLibraryItemSummary | null {
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const id = entityId(raw);
  const name = String(def.name ?? raw.name ?? '').trim();
  if (!id || !name) return null;
  const texts = buildItemTexts(def, name);
  return {
    ddbId: id,
    name,
    type: String(def.type ?? def.filterType ?? 'Item').trim(),
    rarity: String(def.rarity ?? def.rarityName ?? '').trim() || undefined,
    source: sourceLabelFromEntries(raw.sources ?? def.sources),
    description: texts.description,
  };
}

export function normalizeDdbItemToCompendium(raw: Record<string, unknown>): OwlbearItem | null {
  const summary = normalizeDdbItemSummary(raw);
  if (!summary) return null;
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const texts = buildItemTexts(def, summary.name);
  return {
    name: summary.name,
    type: summary.type,
    source: summary.source ?? 'D&D Beyond',
    description: texts.description || summary.name,
    ...(summary.rarity ? { rarity: summary.rarity } : {}),
    ...(texts.flavor ? { flavor: texts.flavor } : {}),
    details: texts.details,
    ...(String(def.largeAvatarUrl ?? def.avatarUrl ?? raw.largeAvatarUrl ?? '').trim()
      ? { image: String(def.largeAvatarUrl ?? def.avatarUrl ?? raw.largeAvatarUrl).trim() }
      : {}),
  };
}

export function normalizeDdbSpellSummary(raw: Record<string, unknown>): DdbLibrarySpellSummary | null {
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const id = entityId(raw);
  const name = String(def.name ?? raw.name ?? '').trim();
  if (!id || !name) return null;
  const level = pickNumber(def.level, raw.level) ?? 0;
  const school = String(def.school ?? def.schoolName ?? '').trim() || undefined;
  const damage = def.damage && typeof def.damage === 'object'
    ? stripDdbHtml((def.damage as Record<string, unknown>).dice)
    : stripDdbHtml(def.dice ?? '');
  return {
    ddbId: id,
    name,
    level,
    school,
    damage: damage || undefined,
    source: sourceLabelFromEntries(def.sources ?? raw.sources),
  };
}

export function normalizeDdbSpellToCompendium(raw: Record<string, unknown>): OwlbearSpell | null {
  const summary = normalizeDdbSpellSummary(raw);
  if (!summary) return null;
  const def = (raw.definition ?? raw) as Record<string, unknown>;
  const saveAbility = def.savingThrow && typeof def.savingThrow === 'object'
    ? normalizeAbilityName((def.savingThrow as Record<string, unknown>).abilityId
      ?? (def.savingThrow as Record<string, unknown>).statId)
    : undefined;
  const range = def.range && typeof def.range === 'object'
    ? (def.range as Record<string, unknown>)
    : null;
  const aoe = range?.aoeType && range?.aoeSize
    ? { size: Number(range.aoeSize), type: String(range.aoeType).toLowerCase() }
    : undefined;

  return {
    name: summary.name,
    level: summary.level,
    source: summary.source ?? 'D&D Beyond',
    ...(summary.damage ? { damage: summary.damage } : {}),
    ...(summary.school ? { type: summary.school.toLowerCase() } : {}),
    ...(saveAbility && saveAbility !== '???' ? { save: saveAbility } : {}),
    ...(aoe && Number.isFinite(aoe.size) ? { aoe } : {}),
    attack: Boolean(def.attackType ?? def.requiresAttackRoll),
    description: buildSpellDescription(def),
  };
}

export function entryMatchesSource(sourceLabel: string | undefined, sourceId: number): boolean {
  if (!sourceLabel) return false;
  return sourceLabel.includes(String(sourceId));
}

/** Book-sourced DDB imports should replace matching compendium entries (e.g. Monster Manual). */
export function ddbImportSaveAs(entry: { source?: string }): 'replace' | 'homebrew' {
  const src = (entry.source ?? '').trim();
  if (!src || src === 'D&D Beyond' || src.toLowerCase() === 'custom') return 'homebrew';
  return 'replace';
}
