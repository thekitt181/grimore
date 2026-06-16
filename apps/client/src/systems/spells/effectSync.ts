import type { SpellEffectSyncPayload, SpellEffectReminderPayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { useSpellEffectStore } from './effectStore';
import {
  loadSpellEffectsLocal,
  persistSpellEffectsLocal,
} from './effectPersistence';

export function syncSpellEffectsToServer(): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  const { effects, settings } = useSpellEffectStore.getState();
  const payload: SpellEffectSyncPayload = { sessionId, effects, settings };
  persistSpellEffectsLocal(sessionId, payload);
  (getSocket() as { emit: (event: string, data: unknown) => void }).emit('effect:sync', payload);
}

export function emitEffectReminder(reminder: Omit<SpellEffectReminderPayload, 'sessionId'>): void {
  const sessionId = useSessionStore.getState().sessionId;
  if (!sessionId) return;
  const payload: SpellEffectReminderPayload = { ...reminder, sessionId };
  useSpellEffectStore.getState().pushReminder(payload);
  (getSocket() as { emit: (event: string, data: unknown) => void }).emit('effect:remind', payload);
}

export function hydrateSpellEffectsFromLocal(sessionId: string): void {
  const saved = loadSpellEffectsLocal(sessionId);
  if (saved) {
    useSpellEffectStore.getState().syncFromServer(saved.effects, saved.settings);
  }
}

export function applySpellEffectSyncPayload(payload: SpellEffectSyncPayload): void {
  useSpellEffectStore.getState().syncFromServer(payload.effects, payload.settings);
  persistSpellEffectsLocal(payload.sessionId, payload);
}

export function applyEffectReminderPayload(payload: SpellEffectReminderPayload): void {
  useSpellEffectStore.getState().pushReminder(payload);
}
