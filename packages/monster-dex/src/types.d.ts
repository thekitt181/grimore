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
export declare function getAbilityModifier(score: number): number;
export declare function formatModifier(modifier: number): string;
export declare function getCRDisplay(cr: number): string;
//# sourceMappingURL=types.d.ts.map