import { create } from 'zustand';
import type {
  ActiveSpellEffect,
  SessionCombatSettings,
  SpellEffectReminderPayload,
} from '@grimoire/shared';
import { DEFAULT_COMBAT_SETTINGS } from '@grimoire/shared';

function mergeSyncedSettings(settings: SessionCombatSettings): SessionCombatSettings {
  const envJb2a = (import.meta.env.VITE_JB2A_BASE_URL as string | undefined)?.trim();
  if (!settings.jb2aBaseUrl && envJb2a) {
    return { ...settings, jb2aBaseUrl: envJb2a };
  }
  return settings;
}

interface SpellEffectState {
  effects: ActiveSpellEffect[];
  settings: SessionCombatSettings;
  reminders: SpellEffectReminderPayload[];

  syncFromServer: (effects: ActiveSpellEffect[], settings: SessionCombatSettings) => void;
  setSettings: (settings: Partial<SessionCombatSettings>) => void;
  upsertEffect: (effect: ActiveSpellEffect) => void;
  removeEffect: (id: string, reason: ActiveSpellEffect['endReason']) => void;
  pushReminder: (reminder: SpellEffectReminderPayload) => void;
  dismissReminder: (effectId: string, kind: SpellEffectReminderPayload['kind']) => void;
}

export const useSpellEffectStore = create<SpellEffectState>((set, get) => ({
  effects: [],
  settings: { ...DEFAULT_COMBAT_SETTINGS },
  reminders: [],

  syncFromServer: (effects, settings) =>
    set({ effects: effects.filter((e) => !e.ended), settings: mergeSyncedSettings(settings) }),

  setSettings: (patch) =>
    set((s) => ({ settings: { ...s.settings, ...patch } })),

  upsertEffect: (effect) =>
    set((s) => {
      const rest = s.effects.filter((e) => e.id !== effect.id);
      if (effect.ended) return { effects: rest };
      return { effects: [...rest, effect] };
    }),

  removeEffect: (id, reason) =>
    set((s) => ({
      effects: s.effects.filter((e) => {
        if (e.id !== id) return true;
        return false;
      }),
    })),

  pushReminder: (reminder) =>
    set((s) => ({
      reminders: [...s.reminders.filter((r) => r.effectId !== reminder.effectId || r.kind !== reminder.kind), reminder],
    })),

  dismissReminder: (effectId, kind) =>
    set((s) => ({
      reminders: s.reminders.filter((r) => !(r.effectId === effectId && r.kind === kind)),
    })),
}));

export function activeEffectsForCaster(casterTokenId: string): ActiveSpellEffect[] {
  return useSpellEffectStore.getState().effects.filter(
    (e) => e.casterTokenId === casterTokenId && !e.ended,
  );
}

export function concentratingEffect(casterTokenId: string): ActiveSpellEffect | undefined {
  return useSpellEffectStore.getState().effects.find(
    (e) => e.casterTokenId === casterTokenId && e.concentration && !e.ended,
  );
}
