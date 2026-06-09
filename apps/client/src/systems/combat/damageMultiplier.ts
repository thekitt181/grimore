export type DamageMultiplier = 'normal' | 'half' | 'quarter' | 'double';

export const DAMAGE_MULTIPLIERS: DamageMultiplier[] = ['quarter', 'half', 'normal', 'double'];

export const MULTIPLIER_LABELS: Record<DamageMultiplier, string> = {
  quarter: '¼',
  half: '½',
  normal: '1×',
  double: '2×',
};

export function scaleDamage(base: number, multiplier: DamageMultiplier): number {
  const n = Math.max(0, base);
  switch (multiplier) {
    case 'double':
      return n * 2;
    case 'half':
      return Math.floor(n / 2);
    case 'quarter':
      return Math.floor(n / 4);
    default:
      return n;
  }
}

export function formatScaledDamage(base: number, multiplier: DamageMultiplier): string {
  const scaled = scaleDamage(base, multiplier);
  if (multiplier === 'normal') return String(scaled);
  return `${scaled} (${MULTIPLIER_LABELS[multiplier]} of ${base})`;
}
