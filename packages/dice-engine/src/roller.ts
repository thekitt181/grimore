import { DiceRoller } from '@dice-roller/rpg-dice-roller';
import type { DiceRollPayload } from '@grimoire/shared';

const roller = new DiceRoller();

export type RollMode = 'normal' | 'advantage' | 'disadvantage';

function collectDieValues(node: unknown, out: number[]): void {
  if (node == null) return;
  if (typeof node === 'number' || typeof node === 'string') return;
  if (typeof node !== 'object') return;

  if ('rolls' in node && Array.isArray((node as { rolls: unknown[] }).rolls)) {
    for (const child of (node as { rolls: unknown[] }).rolls) {
      collectDieValues(child, out);
    }
    return;
  }

  if ('value' in node && typeof (node as { value: unknown }).value === 'number') {
    const typed = node as { type?: string; value: number };
    if (!typed.type || typed.type === 'result') {
      out.push(typed.value);
    }
  }
}

export interface RollResult {
  notation: string;
  results: number[];
  /** Values that counted toward the total (e.g. higher d20 for advantage). */
  usedResults: number[];
  /** Values discarded by advantage/disadvantage. */
  droppedResults: number[];
  total: number;
  isCrit: boolean;
  isCritFail: boolean;
  rollMode: RollMode;
}

/** Collapse whitespace for dice expressions like "2d6 + 3". */
export function normalizeNotation(notation: string): string {
  return notation.replace(/\s+/g, '');
}

/** Build notation like `3d6+2` from parts. */
export function formatDiceNotation(count: number, sides: number, modifier = 0): string {
  const n = Math.max(1, Math.floor(count) || 1);
  const s = Math.max(2, Math.floor(sides) || 6);
  const base = `${n}d${s}`;
  if (!modifier) return base;
  return `${base}${modifier >= 0 ? '+' : ''}${modifier}`;
}

/** Parse a simple `NdS+M` expression, or null if not a single die group. */
export function parseSimpleDiceNotation(notation: string): { count: number; sides: number; modifier: number } | null {
  const cleaned = normalizeNotation(notation);
  const m = cleaned.match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) return null;
  const count = m[1] ? parseInt(m[1], 10) : 1;
  const sides = parseInt(m[2]!, 10);
  const modifier = m[3] ? parseInt(m[3], 10) : 0;
  if (!Number.isFinite(count) || !Number.isFinite(sides) || count < 1 || sides < 2) return null;
  return { count, sides, modifier: Number.isFinite(modifier) ? modifier : 0 };
}

function rollRaw(notation: string) {
  const cleaned = normalizeNotation(notation);
  const rolled = roller.roll(cleaned);
  return { cleaned, roll: Array.isArray(rolled) ? rolled[0]! : rolled };
}

function parseModifier(suffix: string | undefined): number {
  if (!suffix) return 0;
  const n = Number(suffix);
  return Number.isFinite(n) ? n : 0;
}

function rollSingleFace(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parse and evaluate a dice notation string (e.g. "2d6+3", "1d20").
 * Supports advantage/disadvantage on d20 rolls.
 */
export function rollDice(notation: string, mode: RollMode = 'normal'): RollResult {
  const { cleaned, roll } = rollRaw(notation);

  const d20Match = cleaned.match(/^(\d*)d20([+-]\d+)?$/i);
  if (mode !== 'normal' && d20Match) {
    const modifier = parseModifier(d20Match[2]);
    const r1 = rollSingleFace(20);
    const r2 = rollSingleFace(20);
    const picked = mode === 'advantage' ? Math.max(r1, r2) : Math.min(r1, r2);
    const dropped = picked === r1 ? r2 : r1;
    const total = picked + modifier;
    return {
      notation: cleaned,
      results: [r1, r2],
      usedResults: [picked],
      droppedResults: [dropped],
      total,
      isCrit: picked === 20,
      isCritFail: picked === 1,
      rollMode: mode,
    };
  }

  const results: number[] = [];
  for (const die of roll.rolls) {
    collectDieValues(die, results);
  }

  const total = roll.total;
  const isSingleD20 = cleaned.match(/^1?d20([+-]\d+)?$/i) !== null;
  const d20Face = isSingleD20 && results.length === 1 ? results[0] : null;

  return {
    notation: cleaned,
    results,
    usedResults: results,
    droppedResults: [],
    total,
    isCrit: d20Face === 20,
    isCritFail: d20Face === 1,
    rollMode: 'normal',
  };
}

/** True when notation is a d20 check (advantage/disadvantage applies). */
export function isD20Notation(notation: string): boolean {
  const cleaned = normalizeNotation(notation);
  return /^(\d*)d20([+-]\d+)?$/i.test(cleaned);
}

/** Extract die sides from notation for 3D animation (e.g. "2d6+3" → [6,6]). */
export function expandDieFaces(notation: string): number[] {
  const cleaned = normalizeNotation(notation);
  const faces: number[] = [];
  const re = /(\d*)d(\d+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(cleaned)) !== null) {
    const count = match[1] ? parseInt(match[1], 10) : 1;
    const sides = parseInt(match[2]!, 10);
    if (!Number.isFinite(count) || !Number.isFinite(sides) || sides < 2) continue;
    for (let i = 0; i < count; i++) faces.push(sides);
  }
  return faces.length ? faces : [20];
}

export function buildDicePayload(
  notation: string,
  rollerId: string,
  rollerName: string,
  sessionId: string,
  isSecret = false,
  mode: RollMode = 'normal',
): DiceRollPayload {
  const result = rollDice(notation, mode);
  return {
    sessionId,
    rollerId,
    rollerName,
    notation,
    results: result.results,
    usedResults: result.usedResults,
    droppedResults: result.droppedResults,
    total: result.total,
    isSecret,
    isCrit: result.isCrit,
    isCritFail: result.isCritFail,
    rollMode: result.rollMode,
    timestamp: Date.now(),
  };
}
