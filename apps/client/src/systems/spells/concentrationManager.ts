import {
  concentrationSaveDc,
  concentrationSaveMessage,
  isDurationExpired,
  type GameTime,
} from '@grimoire/shared';
import type { TokenItem } from '@/systems/scene/types';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useSceneMediaStore } from '@/systems/scene/media/sceneMediaStore';
import { concentratingEffect, useSpellEffectStore } from './effectStore';
import { endSpellEffect } from './castSpellEffect';
import { emitEffectReminder, syncSpellEffectsToServer } from './effectSync';

function currentGameTime(): GameTime | undefined {
  return useSceneMediaStore.getState().activeScene?.gameTime
    ?? useSceneMediaStore.getState().sessionGameTime
    ?? undefined;
}

export function tickSpellEffectsOnRoundChange(round: number): void {
  const now = currentGameTime();
  const store = useSpellEffectStore.getState();
  for (const effect of [...store.effects]) {
    if (effect.ended) continue;

    if (effect.duration.totalRounds != null) {
      const elapsed = Math.max(0, round - effect.startedRound);
      const left = effect.duration.totalRounds - elapsed;
      if (left === 1) {
        emitEffectReminder({
          kind: 'effect-expiring',
          effectId: effect.id,
          spellName: effect.spellName,
          casterTokenId: effect.casterTokenId,
          casterName: effect.casterName,
          targetUserIds: effect.casterUserId ? [effect.casterUserId] : [],
          message: `${effect.spellName} ends after this round.`,
        });
      }
    }

    if (!isDurationExpired(effect, round, now)) continue;

    endSpellEffect(effect.id, 'expired');
    emitEffectReminder({
      kind: 'effect-ended',
      effectId: effect.id,
      spellName: effect.spellName,
      casterTokenId: effect.casterTokenId,
      casterName: effect.casterName,
      targetUserIds: effect.casterUserId ? [effect.casterUserId] : [],
      message: `${effect.spellName} has ended.`,
    });
  }
  syncSpellEffectsToServer();
}

export function onTokenTookDamageForConcentration(
  token: TokenItem,
  damageTaken: number,
  casterUserId?: string,
): void {
  if (damageTaken <= 0) return;
  const effect = concentratingEffect(token.id);
  if (!effect) return;

  const incap = token.conditions.some((c) =>
    ['Incapacitated', 'Unconscious', 'Paralyzed', 'Stunned', 'Petrified'].includes(c),
  );
  if (incap) {
    endSpellEffect(effect.id, 'concentration');
    emitEffectReminder({
      kind: 'concentration-lost',
      effectId: effect.id,
      spellName: effect.spellName,
      casterTokenId: token.id,
      casterName: token.name,
      targetUserIds: casterUserId ? [casterUserId] : [],
      message: `Concentration on ${effect.spellName} lost (${token.name} incapacitated).`,
    });
    return;
  }

  const dc = concentrationSaveDc(damageTaken);
  emitEffectReminder({
    kind: 'concentration-save',
    effectId: effect.id,
    spellName: effect.spellName,
    casterTokenId: token.id,
    casterName: token.name,
    targetUserIds: casterUserId ? [casterUserId] : [],
    message: concentrationSaveMessage(effect.spellName, dc, damageTaken),
    concentrationDc: dc,
  });
}

export function resolveConcentrationSave(effectId: string, passed: boolean): void {
  const effect = useSpellEffectStore.getState().effects.find((e) => e.id === effectId);
  if (!effect || !effect.concentration) return;
  useSpellEffectStore.getState().dismissReminder(effectId, 'concentration-save');
  if (passed) return;
  endSpellEffect(effectId, 'concentration');
  emitEffectReminder({
    kind: 'concentration-lost',
    effectId,
    spellName: effect.spellName,
    casterTokenId: effect.casterTokenId,
    casterName: effect.casterName,
    targetUserIds: effect.casterUserId ? [effect.casterUserId] : [],
    message: `Concentration on ${effect.spellName} failed — spell ends.`,
  });
}

/** Call when initiative round advances. */
export function hookInitiativeRound(round: number): void {
  tickSpellEffectsOnRoundChange(round);
}
