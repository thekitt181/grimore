import { v4 as uuidv4 } from 'uuid';
import type { ActiveSpellEffect, SpellVfxPreset } from '@grimoire/shared';
import {
  durationToCombatRounds,
  extractDurationFromDescription,
  isDurationExpired,
  parseSpellDurationText,
  setGameTimeExpiry,
} from '@grimoire/shared';
import type { AoePlacement } from '@/systems/combat/aoeGeometry';
import { aoeActionNamesMatch } from '@/systems/combat/aoePlacementUtils';
import { useCombatStore } from '@/systems/combat/combatStore';
import type { TokenItem } from '@/systems/scene/types';
import { useInitiativeStore } from '@/systems/map/store/initiativeStore';
import { useSceneMediaStore } from '@/systems/scene/media/sceneMediaStore';
import { useSpellEffectStore } from './effectStore';
import { syncSpellEffectsToServer } from './effectSync';
import { resolveSpellVfxPreset } from './spellVfxRegistry';
import { findSpellEffectCatalogEntry } from './spellEffectsCatalog';

export interface CastSpellEffectInput {
  spellName: string;
  casterToken: TokenItem;
  concentration?: boolean;
  durationText?: string;
  description?: string;
  aoe?: { size: number; type: string };
  placement?: AoePlacement;
  targetTokenIds?: string[];
  castSlotLevel?: number;
  projectileCount?: number;
  casterUserId?: string;
}

function resolveDurationText(input: CastSpellEffectInput): string {
  if (input.durationText?.trim()) return input.durationText.trim();
  const fromDesc = extractDurationFromDescription(input.description);
  if (fromDesc) return fromDesc;
  const catalog = findSpellEffectCatalogEntry(input.spellName);
  if (catalog?.concentration) return 'Concentration, up to 1 minute';
  if (catalog?.hasZoneLoop) return 'Concentration, up to 10 minutes';
  if (input.concentration) return 'Concentration, up to 1 minute';
  return 'Instantaneous';
}

function removeExpiredZoneEffects(
  round: number,
  gameTime?: ReturnType<typeof useSceneMediaStore.getState>['sessionGameTime'],
): void {
  for (const prev of [...useSpellEffectStore.getState().effects]) {
    if (!prev.placement || !prev.aoe) continue;
    if (isDurationExpired(prev, round, gameTime ?? undefined)) {
      useSpellEffectStore.getState().removeEffect(prev.id, 'expired');
    }
  }
}

function replaceExistingZoneForCast(input: CastSpellEffectInput): void {
  for (const prev of [...useSpellEffectStore.getState().effects]) {
    if (prev.casterTokenId !== input.casterToken.id) continue;
    if (!aoeActionNamesMatch(prev.spellName, input.spellName)) continue;
    useSpellEffectStore.getState().removeEffect(prev.id, 'replaced');
  }
}

export function commitSpellEffect(input: CastSpellEffectInput): ActiveSpellEffect | null {
  const settings = useSpellEffectStore.getState().settings;
  let duration = parseSpellDurationText(resolveDurationText(input));
  if (duration.kind === 'instant') {
    duration = { kind: 'rounds', label: duration.label || 'Instantaneous', totalRounds: 1, remaining: 0 };
  } else {
    duration = durationToCombatRounds(duration, settings);
  }
  const gameTime =
    useSceneMediaStore.getState().activeScene?.gameTime
    ?? useSceneMediaStore.getState().sessionGameTime
    ?? undefined;
  if (gameTime) {
    duration = setGameTimeExpiry(duration, gameTime);
  }

  const round = useInitiativeStore.getState().round;
  const catalog = findSpellEffectCatalogEntry(input.spellName);
  const vfxPreset = resolveSpellVfxPreset(input.spellName, input.aoe?.type);
  const concentration = Boolean(input.concentration ?? catalog?.concentration);

  removeExpiredZoneEffects(round, gameTime);
  replaceExistingZoneForCast(input);

  if (concentration) {
    for (const prev of useSpellEffectStore.getState().effects) {
      if (prev.casterTokenId === input.casterToken.id && prev.concentration && !prev.ended) {
        useSpellEffectStore.getState().removeEffect(prev.id, 'replaced');
      }
    }
  }

  const effect: ActiveSpellEffect = {
    id: uuidv4(),
    spellName: input.spellName,
    casterTokenId: input.casterToken.id,
    casterName: input.casterToken.name,
    targetTokenIds: input.targetTokenIds ?? [],
    ...(input.castSlotLevel != null ? { castSlotLevel: input.castSlotLevel } : {}),
    ...(input.projectileCount != null ? { projectileCount: input.projectileCount } : {}),
    concentration,
    duration,
    startedRound: round,
    ...(gameTime ? { startedAtGameTime: gameTime } : {}),
    ...(input.aoe ? { aoe: input.aoe } : {}),
    ...(input.placement
      ? {
          placement: {
            originX: input.placement.originX,
            originY: input.placement.originY,
            angleRad: input.placement.angleRad,
            centerX: input.placement.centerX,
            centerY: input.placement.centerY,
          },
        }
      : {}),
    vfxPreset,
    vfxColor: '#c9a84c',
    visibleTo: 'all',
    ended: false,
    triggerCastVfx: true,
    ...(input.casterUserId || input.casterToken.ownerId
      ? { casterUserId: input.casterUserId ?? input.casterToken.ownerId }
      : {}),
  };

  useSpellEffectStore.getState().upsertEffect(effect);

  // Clear combat AoE placement template only — do not purge spell VFX layers.
  if (input.placement && input.aoe) {
    useCombatStore.getState().clearMapAoeShapes();
  }

  syncSpellEffectsToServer();
  return effect;
}

export function endSpellEffect(id: string, reason: ActiveSpellEffect['endReason'] = 'manual'): void {
  useSpellEffectStore.getState().removeEffect(id, reason);
  syncSpellEffectsToServer();
}
