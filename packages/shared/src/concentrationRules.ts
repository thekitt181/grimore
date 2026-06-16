/** D&D 5e concentration save DC: max(10, half damage taken, rounded down). */
export function concentrationSaveDc(damageTaken: number): number {
  return Math.max(10, Math.floor(damageTaken / 2));
}

export function mustBreakConcentrationOnDamage(
  damageTaken: number,
  isIncapacitated: boolean,
): boolean {
  if (isIncapacitated) return true;
  return damageTaken > 0;
}

export function concentrationSaveMessage(
  spellName: string,
  dc: number,
  damageTaken: number,
): string {
  return `Concentration check for ${spellName}: CON save DC ${dc} (took ${damageTaken} damage).`;
}
