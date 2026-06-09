import type { AbilityScore } from '@grimoire/shared';

export interface MonsterAbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export interface MonsterAction {
  name: string;
  desc: string;
  attackBonus?: number;
  damageDice?: string;
  damageBonus?: number;
  damageType?: string;
}

export interface Monster {
  index: string;
  name: string;
  size: 'Tiny' | 'Small' | 'Medium' | 'Large' | 'Huge' | 'Gargantuan';
  type: string;
  alignment: string;
  armorClass: number;
  hitPoints: number;
  hitDice: string;
  speed: Record<string, string>;
  abilityScores: MonsterAbilityScores;
  savingThrows: Partial<Record<AbilityScore, number>>;
  skills: Record<string, number>;
  damageImmunities: string[];
  damageResistances: string[];
  conditionImmunities: string[];
  senses: Record<string, string>;
  languages: string;
  challengeRating: number;
  xp: number;
  specialAbilities: MonsterAction[];
  actions: MonsterAction[];
  legendaryActions?: MonsterAction[];
  lairActions?: MonsterAction[];
  imageUrl?: string;
  source?: 'SRD' | 'DND_BEYOND';
}

export function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(modifier: number): string {
  return modifier >= 0 ? `+${modifier}` : String(modifier);
}

export function getCRDisplay(cr: number): string {
  if (cr === 0.125) return '1/8';
  if (cr === 0.25) return '1/4';
  if (cr === 0.5) return '1/2';
  return String(cr);
}
