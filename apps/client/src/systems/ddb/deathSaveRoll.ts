import type { RollResult } from '@grimoire/dice-engine';
import type { GrimoireCharacter } from '@grimoire/shared';

export type DeathSavesState = GrimoireCharacter['deathSaves'];

function clampCount(n: number): number {
  return Math.max(0, Math.min(3, n));
}

export function normalizeDeathSaves(deathSaves: DeathSavesState): DeathSavesState {
  const successes = clampCount(deathSaves.successes ?? 0);
  const failures = clampCount(deathSaves.failures ?? 0);
  const stabilized = Boolean(deathSaves.stabilized) || successes >= 3;
  return { successes, failures, stabilized };
}

export function applyDeathSaveRoll(
  current: DeathSavesState,
  result: RollResult,
): { deathSaves: DeathSavesState; hp?: number } {
  const state = normalizeDeathSaves(current);
  if (state.stabilized || state.successes >= 3 || state.failures >= 3) {
    return { deathSaves: state };
  }

  if (result.isCrit) {
    return {
      deathSaves: { successes: 0, failures: 0, stabilized: false },
      hp: 1,
    };
  }

  let { successes, failures } = state;
  if (result.isCritFail) failures = clampCount(failures + 2);
  else if (result.total >= 10) successes = clampCount(successes + 1);
  else failures = clampCount(failures + 1);

  const stabilized = successes >= 3;
  return { deathSaves: { successes, failures, stabilized } };
}

export function setDeathSaveCount(
  current: DeathSavesState,
  kind: 'successes' | 'failures',
  count: number,
): DeathSavesState {
  const next = normalizeDeathSaves(current);
  next[kind] = clampCount(count);
  if (kind === 'successes' && next.successes >= 3) next.stabilized = true;
  if (kind === 'failures' && next.failures >= 3) next.stabilized = false;
  if (next.successes < 3 && next.failures < 3) next.stabilized = false;
  return next;
}

export function clearDeathSaves(): DeathSavesState {
  return { successes: 0, failures: 0, stabilized: false };
}
