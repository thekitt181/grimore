import { addGameMinutes, type GameTime } from './gameTime';
import type { SessionCombatSettings, SpellDurationKind, SpellDurationSpec } from './types/spellEffect';

const ROUND_DURATION_RE =
  /(\d+)\s*round/i;
const MINUTE_DURATION_RE =
  /(?:up to\s+)?(\d+)\s*minute/i;
const HOUR_DURATION_RE =
  /(?:up to\s+)?(\d+)\s*hour/i;

export function parseSpellDurationText(text: string): SpellDurationSpec {
  const label = text.trim();
  if (!label || /^instant/i.test(label)) {
    return { kind: 'instant', label: label || 'Instantaneous' };
  }
  if (/until dispelled|permanent|special/i.test(label)) {
    return { kind: 'untilDispelled', label };
  }

  const roundMatch = ROUND_DURATION_RE.exec(label);
  if (roundMatch) {
    const n = Number(roundMatch[1]);
    return { kind: 'rounds', label, remaining: n, totalRounds: n };
  }

  const minuteMatch = MINUTE_DURATION_RE.exec(label);
  if (minuteMatch) {
    const n = Number(minuteMatch[1]);
    return { kind: 'minutes', label, remaining: n };
  }

  const hourMatch = HOUR_DURATION_RE.exec(label);
  if (hourMatch) {
    const n = Number(hourMatch[1]);
    return { kind: 'hours', label, remaining: n };
  }

  if (/concentration/i.test(label)) {
    return { kind: 'special', label };
  }

  return { kind: 'special', label };
}

/** Convert minute/hour duration to combat rounds using session setting. */
export function durationToCombatRounds(
  spec: SpellDurationSpec,
  settings: SessionCombatSettings,
): SpellDurationSpec {
  if (spec.kind === 'rounds' && spec.remaining != null) {
    return { ...spec, totalRounds: spec.remaining };
  }
  if (spec.kind === 'minutes' && spec.remaining != null) {
    const totalRounds = Math.max(1, Math.ceil(spec.remaining * settings.roundsPerMinute));
    return { ...spec, totalRounds, remaining: spec.remaining };
  }
  if (spec.kind === 'hours' && spec.remaining != null) {
    const totalRounds = Math.max(1, Math.ceil(spec.remaining * 60 * settings.roundsPerMinute));
    return { ...spec, totalRounds, remaining: spec.remaining };
  }
  return spec;
}

export function setGameTimeExpiry(
  spec: SpellDurationSpec,
  start: GameTime,
): SpellDurationSpec {
  if (spec.kind === 'minutes' && spec.remaining != null) {
    return { ...spec, expiresAtGameTime: addGameMinutes(start, spec.remaining) };
  }
  if (spec.kind === 'hours' && spec.remaining != null) {
    return { ...spec, expiresAtGameTime: addGameMinutes(start, spec.remaining * 60) };
  }
  return spec;
}

export function formatDurationRemaining(spec: SpellDurationSpec, round: number): string {
  if (spec.kind === 'instant') return 'Instant';
  if (spec.kind === 'untilDispelled') return 'Until dispelled';
  if (spec.kind === 'rounds' && spec.totalRounds != null) {
    const left = Math.max(0, spec.totalRounds);
    return `${left} round${left === 1 ? '' : 's'}`;
  }
  if (spec.totalRounds != null) {
    return `${spec.totalRounds} rounds (${spec.label})`;
  }
  return spec.label;
}

export function tickDurationOnRoundAdvance(
  effect: { duration: SpellDurationSpec; startedRound: number },
  currentRound: number,
): SpellDurationSpec {
  const d = effect.duration;
  if (d.kind === 'instant' || d.kind === 'untilDispelled' || d.kind === 'special') return d;
  if (d.totalRounds == null) return d;
  const elapsed = Math.max(0, currentRound - effect.startedRound);
  const remainingRounds = Math.max(0, d.totalRounds - elapsed);
  return { ...d, totalRounds: remainingRounds };
}

export function isDurationExpired(
  effect: { duration: SpellDurationSpec; startedRound: number },
  currentRound: number,
  nowGameTime?: GameTime,
): boolean {
  const d = effect.duration;
  if (d.kind === 'instant') return false;
  if (d.kind === 'untilDispelled' || d.kind === 'special') return false;
  if (d.totalRounds != null) {
    const elapsed = Math.max(0, currentRound - effect.startedRound);
    if (elapsed >= d.totalRounds) return true;
  }
  if (d.expiresAtGameTime && nowGameTime) {
    const exp = d.expiresAtGameTime.hour * 60 + d.expiresAtGameTime.minute;
    const now = nowGameTime.hour * 60 + nowGameTime.minute;
    if (now >= exp) return true;
  }
  return false;
}

export function extractDurationFromDescription(description?: string): string {
  if (!description) return '';
  const m = /Duration:\s*([^\n]+)/i.exec(description);
  return m?.[1]?.trim() ?? '';
}
