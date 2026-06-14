import type { CSSProperties } from 'react';

export const GOLD = 'var(--color-accent-gold)';
export const BD = 'var(--color-border)';

export function dmTabStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'rgba(201,168,76,0.2)' : 'transparent',
    color: active ? GOLD : 'var(--color-text-secondary)',
    border: `1px solid ${active ? GOLD : BD}`,
  };
}
