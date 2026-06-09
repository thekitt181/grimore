export function readTempHp(value: number | undefined): number {
  return Math.max(0, value ?? 0);
}

/** Damage hits temp HP first, then regular HP. */
export function applyDamage(
  hp: number,
  tempHp: number,
  amount: number,
): { hp: number; tempHp: number } {
  let t = readTempHp(tempHp);
  let h = Math.max(0, hp);
  let dmg = Math.max(0, amount);

  if (t > 0 && dmg > 0) {
    const fromTemp = Math.min(t, dmg);
    t -= fromTemp;
    dmg -= fromTemp;
  }
  if (dmg > 0) h = Math.max(0, h - dmg);

  return { hp: h, tempHp: t };
}

/** Healing only restores regular HP up to max. */
export function applyHeal(hp: number, maxHp: number, amount: number): number {
  return Math.min(Math.max(1, maxHp), Math.max(0, hp) + Math.max(0, amount));
}
