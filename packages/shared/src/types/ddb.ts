/** Normalized D&D Beyond character for Grimoire VTT. */

export interface GrimoireAbility {
  name: string;
  score: number;
  mod: number;
}

export interface GrimoireSkill {
  name: string;
  mod: number;
  proficient: boolean;
}

export interface GrimoireSave {
  name: string;
  mod: number;
  proficient: boolean;
}

export interface GrimoireAttack {
  id: string;
  name: string;
  toHit: number;
  damageDice: string;
  damageType: string;
  range?: string;
  properties?: string[];
  extraDamages?: { dice: string; type: string; label?: string }[];
}

export interface GrimoireSpell {
  id: string;
  name: string;
  level: number;
  school?: string;
  damage?: string;
  damageType?: string;
  save?: string;
  attack?: boolean;
  aoe?: { size: number; type: string };
  prepared: boolean;
  ritual?: boolean;
  concentration?: boolean;
}

export interface GrimoireSpellSlots {
  level: number;
  total: number;
  used: number;
}

export interface GrimoireInventoryItem {
  id: string;
  name: string;
  quantity: number;
  weight?: number;
  equipped?: boolean;
  type?: string;
}

export interface GrimoireFeature {
  id: string;
  name: string;
  description?: string;
}

export interface GrimoireCharacter {
  ddbCharacterId: number;
  name: string;
  level: number;
  classes: string[];
  race?: string;
  avatarUrl?: string;
  campaignId?: number;
  campaignName?: string;
  hp: number;
  maxHp: number;
  tempHp: number;
  ac: number;
  inspiration: boolean;
  deathSaves: { successes: number; failures: number; stabilized?: boolean };
  abilities: GrimoireAbility[];
  skills: GrimoireSkill[];
  saves: GrimoireSave[];
  attacks: GrimoireAttack[];
  spells: GrimoireSpell[];
  spellSlots: GrimoireSpellSlots[];
  inventory: GrimoireInventoryItem[];
  features: GrimoireFeature[];
  feats: GrimoireFeature[];
  conditions: string[];
  damageResistances: string[];
  damageImmunities: string[];
  damageVulnerabilities: string[];
  conditionImmunities: string[];
  spellSaveDc?: number;
  spellAttackMod?: number;
  proficiencyBonus: number;
  updateId?: number;
  lastSyncedAt?: string;
}

export interface DdbCharacterSummary {
  ddbCharacterId: number;
  name: string;
  level: number;
  classLabel: string;
  avatarUrl?: string;
  campaignId?: number;
  campaignName?: string;
}

export interface DdbCampaignSummary {
  ddbCampaignId: number;
  name: string;
  characterCount: number;
}

export interface DdbEncounterMonster {
  ddbMonsterId?: number;
  name: string;
  cr?: string;
  hp?: number;
  ac?: number;
  count: number;
}

export interface DdbEncounter {
  id: string;
  name: string;
  monsters: DdbEncounterMonster[];
}

export interface DdbLinkStatus {
  linked: boolean;
  valid?: boolean;
  linkedAt?: string;
  lastValidatedAt?: string;
  syncHpToDdb?: boolean;
  rollBridgeEnabled?: boolean;
}

/** Pseudo source id for D&D Beyond homebrew (monsters, spells, items). */
export const DDB_HOMEBREW_SOURCE_ID = -1;
export const DDB_HOMEBREW_SOURCE_NAME = 'My D&D Beyond Homebrew';
export const DDB_HOMEBREW_SOURCE_LABEL = 'D&D Beyond Homebrew';

/** Source book / entitlement from DDB config (owned + shared). */
export interface DdbSourceSummary {
  id: number;
  name: string;
  category?: string;
  accessType?: string;
  isEnabled?: boolean;
}

export interface DdbLibraryMonsterSummary {
  ddbId: number;
  name: string;
  cr: string;
  hp?: number;
  ac?: number;
  source?: string;
  imageUrl?: string;
  isHomebrew?: boolean;
}

export interface DdbLibrarySpellSummary {
  ddbId: number;
  name: string;
  level: number;
  school?: string;
  damage?: string;
  source?: string;
}

export interface DdbLibraryItemSummary {
  ddbId: number;
  name: string;
  type: string;
  rarity?: string;
  source?: string;
  description: string;
}

export interface DdbLibraryImportResult {
  imported: Array<{
    kind: 'monster' | 'item' | 'spell';
    ddbId: number;
    compendiumId: string;
    name: string;
    source?: string;
  }>;
  errors: Array<{ id: number; message: string }>;
  /** Catalog revision after import (server rebuild complete). */
  catalogRev?: string;
  /** Book sources unlocked for players after import. */
  sourcesUnlocked?: string[];
  /** True when Mongo acknowledged the global doc write. */
  mongoPersisted?: boolean;
  /** Entries skipped because they already exist in Mongo (reimport mode). */
  skipped?: number;
}

export interface DdbRollBridgePayload {
  sessionId: string;
  characterName: string;
  ddbCharacterId?: number;
  label: string;
  notation: string;
  total: number;
  isDamage: boolean;
  /** Individual die results from DDB (when available). */
  diceResults?: number[];
  damageApplied?: number;
  /** D&D Beyond game-log message id — used to dedupe WS + HTTP poll delivery. */
  messageId?: string;
}

export interface DdbCharacterSyncPayload {
  sessionId: string;
  ddbCharacterId: number;
  characterName: string;
}

export interface DdbHpUpdatePayload {
  sessionId: string;
  ddbCharacterId: number;
  hp: number;
  maxHp: number;
  tempHp: number;
  pushedToDdb: boolean;
}

const DDB_ABILITY_BY_ID: Record<string, string> = {
  '1': 'STR',
  '2': 'DEX',
  '3': 'CON',
  '4': 'INT',
  '5': 'WIS',
  '6': 'CHA',
};

const DDB_ABILITY_BY_NAME: Record<string, string> = {
  STRENGTH: 'STR',
  DEXTERITY: 'DEX',
  CONSTITUTION: 'CON',
  INTELLIGENCE: 'INT',
  WISDOM: 'WIS',
  CHARISMA: 'CHA',
};

/** Map DDB stat ids (1–6) or full names to STR/DEX/CON/INT/WIS/CHA. */
export function normalizeAbilityName(idOrName: unknown): string {
  const raw = String(idOrName ?? '').trim();
  if (!raw) return '???';
  if (DDB_ABILITY_BY_ID[raw]) return DDB_ABILITY_BY_ID[raw];
  const upper = raw.toUpperCase();
  if (DDB_ABILITY_BY_NAME[upper]) return DDB_ABILITY_BY_NAME[upper];
  if (/^(STR|DEX|CON|INT|WIS|CHA)$/.test(upper)) return upper;
  return upper.slice(0, 3);
}

/** D&D Beyond often returns dice as objects ({ diceCount, diceValue, fixedValue }) — normalize to "1d8+3". */
export function normalizeDiceNotation(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    return value.map(normalizeDiceNotation).filter(Boolean).join(' + ');
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.dice === 'string') return o.dice.trim();
    if (typeof o.diceString === 'string') return o.diceString.trim();
    if (Array.isArray(o.damage)) return normalizeDiceNotation(o.damage);
    const count = o.diceCount ?? o.count ?? 1;
    const sides = o.diceValue ?? o.die ?? o.sides;
    if (sides != null) {
      let s = `${count}d${sides}`;
      const fixed = o.fixedValue ?? o.bonus ?? 0;
      if (typeof fixed === 'number' && fixed !== 0) {
        s += fixed > 0 ? `+${fixed}` : String(fixed);
      }
      return s;
    }
  }
  return '';
}

/** Ensure cached/partial DDB snapshots always have arrays — prevents UI crashes on .map/.length. */
export function coerceGrimoireCharacter(raw: Partial<GrimoireCharacter> & { ddbCharacterId: number }): GrimoireCharacter {
  const defaultAbilities = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'].map((name) => ({
    name,
    score: 10,
    mod: 0,
  }));
  const abilities = Array.isArray(raw.abilities) && raw.abilities.length
    ? raw.abilities.map((a, i) => ({
        ...a,
        name: normalizeAbilityName(a.name) || defaultAbilities[i]?.name || '???',
      }))
    : defaultAbilities;

  const attacks = (Array.isArray(raw.attacks) ? raw.attacks : []).map((a) => ({
    ...a,
    damageDice: normalizeDiceNotation(a.damageDice),
    damageType: a.damageType ?? 'damage',
    ...(Array.isArray(a.extraDamages)
      ? {
          extraDamages: a.extraDamages.map((d) => ({
            ...d,
            dice: normalizeDiceNotation(d.dice),
          })),
        }
      : {}),
  }));

  const spells = (Array.isArray(raw.spells) ? raw.spells : []).map((s) => {
    const damage = normalizeDiceNotation(s.damage);
    if (!damage) {
      const { damage: _drop, ...rest } = s;
      return rest;
    }
    return { ...s, damage };
  });

  return {
    ddbCharacterId: raw.ddbCharacterId,
    name: raw.name ?? 'Character',
    level: raw.level ?? 1,
    classes: Array.isArray(raw.classes) && raw.classes.length ? raw.classes : ['Adventurer'],
    hp: raw.hp ?? 0,
    maxHp: raw.maxHp ?? raw.hp ?? 1,
    tempHp: raw.tempHp ?? 0,
    ac: raw.ac ?? 10,
    inspiration: Boolean(raw.inspiration),
    deathSaves: raw.deathSaves ?? { successes: 0, failures: 0 },
    abilities,
    skills: Array.isArray(raw.skills) ? raw.skills : [],
    saves: Array.isArray(raw.saves) ? raw.saves : [],
    attacks,
    spells,
    spellSlots: Array.isArray(raw.spellSlots) ? raw.spellSlots : [],
    inventory: Array.isArray(raw.inventory) ? raw.inventory : [],
    features: Array.isArray(raw.features) ? raw.features : [],
    feats: Array.isArray(raw.feats) ? raw.feats : [],
    conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
    damageResistances: Array.isArray(raw.damageResistances) ? raw.damageResistances : [],
    damageImmunities: Array.isArray(raw.damageImmunities) ? raw.damageImmunities : [],
    damageVulnerabilities: Array.isArray(raw.damageVulnerabilities) ? raw.damageVulnerabilities : [],
    conditionImmunities: Array.isArray(raw.conditionImmunities) ? raw.conditionImmunities : [],
    proficiencyBonus: raw.proficiencyBonus ?? 2,
    ...(raw.race ? { race: raw.race } : {}),
    ...(raw.avatarUrl ? { avatarUrl: raw.avatarUrl } : {}),
    ...(raw.campaignId != null ? { campaignId: raw.campaignId } : {}),
    ...(raw.campaignName ? { campaignName: raw.campaignName } : {}),
    ...(raw.spellSaveDc != null ? { spellSaveDc: raw.spellSaveDc } : {}),
    ...(raw.spellAttackMod != null ? { spellAttackMod: raw.spellAttackMod } : {}),
    ...(raw.updateId != null ? { updateId: raw.updateId } : {}),
    ...(raw.lastSyncedAt ? { lastSyncedAt: raw.lastSyncedAt } : {}),
  };
}
