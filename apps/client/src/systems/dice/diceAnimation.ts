import {
  expandDieFaces,
  normalizeNotation,
  type RollResult,
} from '@grimoire/dice-engine';
import type { DiceAnimationSpec, DiceHistoryEntry } from './diceStore';

function d20Fragment(notation: string): string | null {
  const cleaned = normalizeNotation(notation);
  const match = cleaned.match(/(\d*)d20([+-]\d+)?/i);
  return match?.[0] ?? null;
}

/** Extract primary NdS from free-form notation (labels, DDB text, etc.). */
function primaryDieGroup(notation: string): { count: number; sides: number } | null {
  const cleaned = normalizeNotation(notation);
  const match = cleaned.match(/(\d*)d(\d+)/i);
  if (!match) return null;
  const count = match[1] ? parseInt(match[1], 10) : 1;
  const sides = parseInt(match[2]!, 10);
  if (!Number.isFinite(count) || !Number.isFinite(sides) || count < 1 || sides < 2) return null;
  return { count, sides };
}

function inferDieSides(notation: string, results: number[]): number {
  const group = primaryDieGroup(notation);
  if (group) return group.sides;
  const faces = expandDieFaces(notation);
  if (faces.length > 0) return faces[0]!;
  const max = Math.max(...results, 1);
  if (max <= 4) return 4;
  if (max <= 6) return 6;
  if (max <= 8) return 8;
  if (max <= 10) return 10;
  if (max <= 12) return 12;
  return 20;
}

/** One mesh per die result — pad when notation under-reports pool size (common for DDB). */
function resolveTrayFaces(notation: string, results: number[]): number[] {
  const maxTrayDice = 24;
  const capped = Math.min(results.length, maxTrayDice);
  if (capped <= 0) return [];

  let faces = expandDieFaces(notation);
  if (faces.length >= capped) return faces.slice(0, capped);

  const group = primaryDieGroup(notation);
  if (group && group.count >= capped) {
    return Array.from({ length: capped }, () => group.sides);
  }

  const sides = inferDieSides(notation, results);
  return Array.from({ length: capped }, () => sides);
}

function buildDroppedMask(values: number[], droppedResults: number[]): boolean[] {
  const mask = values.map(() => false);
  const pool = [...droppedResults];
  for (let i = 0; i < values.length; i++) {
    const pi = pool.indexOf(values[i]!);
    if (pi >= 0) {
      mask[i] = true;
      pool.splice(pi, 1);
    }
  }
  return mask;
}

/** Build 3D tray spec — advantage/disadvantage shows two d20s even though notation is 1d20. */
export function buildDiceAnimationSpec(
  id: string,
  roll: Pick<RollResult, 'notation' | 'results' | 'droppedResults' | 'rollMode'>,
): DiceAnimationSpec | null {
  if (roll.results.length === 0) return null;

  const d20 = d20Fragment(roll.notation);
  if (roll.rollMode !== 'normal' && roll.results.length >= 2 && d20) {
    const values = roll.results.slice(0, 2);
    return {
      id,
      faces: [20, 20],
      values,
      droppedMask: buildDroppedMask(values, roll.droppedResults),
    };
  }

  const faces = resolveTrayFaces(roll.notation, roll.results);
  const values = roll.results.slice(0, faces.length);
  return {
    id,
    faces,
    values,
    droppedMask: buildDroppedMask(values, roll.droppedResults),
  };
}

export function formatRollBreakdown(entry: Pick<
  DiceHistoryEntry,
  'results' | 'usedResults' | 'droppedResults' | 'total' | 'rollMode' | 'notation'
>): string {
  if (entry.rollMode !== 'normal' && entry.results.length >= 2) {
    const kept = entry.usedResults[0] ?? entry.results[0] ?? 0;
    const mod = entry.total - kept;
    const modPart = mod !== 0 ? `${mod >= 0 ? ' + ' : ' − '}${Math.abs(mod)}` : '';
    const mode = entry.rollMode === 'advantage' ? 'adv' : 'dis';
    return `d20: ${entry.results.join(', ')} → kept ${kept}${modPart} (${mode})`;
  }

  const d20 = d20Fragment(entry.notation);
  if (d20 && entry.results.length === 1) {
    const kept = entry.usedResults[0] ?? entry.results[0] ?? 0;
    const mod = entry.total - kept;
    if (mod !== 0) {
      return `d20: ${kept}${mod >= 0 ? ' + ' : ' − '}${Math.abs(mod)}`;
    }
  }

  return entry.results.length <= 8
    ? entry.results.join(', ')
    : `${entry.results.length} dice: ${entry.results.join(', ')}`;
}
