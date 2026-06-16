import type { GameTime } from '../gameTime';

/** Serializable AoE placement (matches client aoeGeometry). */
export interface SpellAoePlacement {
  originX: number;
  originY: number;
  angleRad: number;
  centerX: number;
  centerY: number;
}

export type SpellDurationKind =
  | 'instant'
  | 'rounds'
  | 'minutes'
  | 'hours'
  | 'untilDispelled'
  | 'special';

export interface SpellDurationSpec {
  kind: SpellDurationKind;
  /** Original text from spell description. */
  label: string;
  /** For rounds/minutes/hours — how many units remain. */
  remaining?: number;
  /** When kind is minutes/hours and combat uses round ticks. */
  totalRounds?: number;
  /** Game clock expiry (out of combat / long durations). */
  expiresAtGameTime?: GameTime;
}

export type SpellVfxPreset =
  | 'burst-circle'
  | 'burst-cone'
  | 'burst-line'
  | 'burst-cube'
  | 'projectile'
  | 'zone-persistent'
  | 'self-aura';

/** Active spell / ability effect synced to all clients. */
export interface ActiveSpellEffect {
  id: string;
  spellName: string;
  casterTokenId: string;
  casterName: string;
  /** Linked player user id when caster is a PC token. */
  casterUserId?: string;
  targetTokenIds: string[];
  /** Spell slot level used for this cast (0 = cantrip). */
  castSlotLevel?: number;
  /** JB2A projectiles to spawn (may exceed unique target count). */
  projectileCount?: number;
  /** Play one-shot cast VFX when this effect arrives over the network. */
  triggerCastVfx?: boolean;
  concentration: boolean;
  duration: SpellDurationSpec;
  startedRound: number;
  startedAtGameTime?: GameTime;
  aoe?: { size: number; type: string };
  placement?: SpellAoePlacement;
  vfxPreset: SpellVfxPreset;
  /** Hex color for VFX tint (e.g. #c9a84c). */
  vfxColor?: string;
  visibleTo: 'all' | 'gm';
  ended: boolean;
  endReason?: 'expired' | 'dispelled' | 'concentration' | 'replaced' | 'manual';
}

export interface SessionCombatSettings {
  /** D&D default: 6 seconds per round → 10 rounds per minute. */
  roundsPerMinute: number;
  /**
   * Base URL for JB2A Library folder (trailing slash optional).
   * Example: https://your-cdn.com/jb2a/Library or /jb2a/Library when self-hosted.
   */
  jb2aBaseUrl?: string;
}

export const DEFAULT_COMBAT_SETTINGS: SessionCombatSettings = {
  roundsPerMinute: 10,
};

export interface SpellEffectSyncPayload {
  sessionId: string;
  effects: ActiveSpellEffect[];
  settings: SessionCombatSettings;
}

export type SpellEffectReminderKind =
  | 'concentration-save'
  | 'effect-expiring'
  | 'effect-ended'
  | 'concentration-lost';

export interface SpellEffectReminderPayload {
  sessionId: string;
  kind: SpellEffectReminderKind;
  effectId: string;
  spellName: string;
  casterTokenId: string;
  casterName: string;
  /** Player user ids to notify (empty = broadcast to session). */
  targetUserIds: string[];
  message: string;
  /** CON save DC when kind is concentration-save. */
  concentrationDc?: number;
}
