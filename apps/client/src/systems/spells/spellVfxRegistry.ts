import type { SpellVfxPreset } from '@grimoire/shared';
import { useSpellEffectStore } from './effectStore';

const SPELL_VFX_OVERRIDES: Record<string, SpellVfxPreset> = {
  fireball: 'burst-circle',
  'burning hands': 'burst-cone',
  lightning: 'burst-line',
  'lightning bolt': 'burst-line',
  'fog cloud': 'zone-persistent',
  'spirit guardians': 'zone-persistent',
  bless: 'self-aura',
  shield: 'self-aura',
};

export function resolveSpellVfxPreset(spellName: string, aoeType?: string): SpellVfxPreset {
  const key = spellName.trim().toLowerCase();
  if (SPELL_VFX_OVERRIDES[key]) return SPELL_VFX_OVERRIDES[key]!;
  const t = (aoeType ?? '').toLowerCase();
  if (t === 'cone') return 'burst-cone';
  if (t === 'line') return 'burst-line';
  if (t === 'cube' || t === 'square') return 'burst-cube';
  if (t === 'radius' || t === 'sphere' || t === 'circle') return 'burst-circle';
  return 'zone-persistent';
}

/** JB2A Library base URL from env, overridden by session settings when set. */
export function getJb2aBaseUrl(): string {
  const fromSettings = useSpellEffectStore.getState().settings.jb2aBaseUrl?.trim();
  if (fromSettings) return fromSettings;
  const fromEnv = import.meta.env.VITE_JB2A_BASE_URL as string | undefined;
  return fromEnv?.trim() ?? '';
}

export function jb2aAnimationsEnabled(): boolean {
  return getJb2aBaseUrl().length > 0;
}
