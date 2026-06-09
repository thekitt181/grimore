import { create } from 'zustand';
import {
  rollDice,
  normalizeNotation,
  type RollMode,
  type RollResult,
} from '@grimoire/dice-engine';
import type { DiceRollPayload } from '@grimoire/shared';
import type { DdbRollBridgePayload } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';
import { useSessionStore } from '@/store/sessionStore';
import { buildDiceAnimationSpec } from './diceAnimation';

export interface DiceHistoryEntry {
  id: string;
  rollerName: string;
  label: string;
  notation: string;
  results: number[];
  usedResults: number[];
  droppedResults: number[];
  total: number;
  isCrit: boolean;
  isCritFail: boolean;
  isSecret: boolean;
  secretHidden: boolean;
  rollMode: RollMode;
  timestamp: number;
}

export interface DiceAnimationSpec {
  id: string;
  faces: number[];
  values: number[];
  /** Per-die index: true when discarded by advantage/disadvantage. */
  droppedMask: boolean[];
}

interface DiceState {
  history: DiceHistoryEntry[];
  isSecret: boolean;
  rollMode: RollMode;
  lastToast: DiceHistoryEntry | null;
  activeAnimation: DiceAnimationSpec | null;
  setIsSecret: (v: boolean) => void;
  setRollMode: (mode: RollMode) => void;
  clearToast: () => void;
  clearAnimation: () => void;
  performRoll: (
    notation: string,
    label?: string,
    options?: {
      isSecret?: boolean;
      rollMode?: RollMode;
      animate?: boolean;
      /** Pre-computed roll — avoids re-rolling (combat attacks, scripted rolls). */
      result?: RollResult;
    },
  ) => DiceHistoryEntry | null;
  addRemoteEntry: (payload: DiceRollPayload) => void;
  addDdbRollEntry: (payload: DdbRollBridgePayload) => void;
}

function rollerNameFor(userId: string | null): string {
  const { myUserId, connectedUsers } = useSessionStore.getState();
  if (userId === myUserId) return 'You';
  return connectedUsers.find((u) => u.id === userId)?.username ?? 'Player';
}

let socketHandler: ((payload: DiceRollPayload) => void) | null = null;

export const useDiceStore = create<DiceState>((set, get) => ({
  history: [],
  isSecret: false,
  rollMode: 'normal',
  lastToast: null,
  activeAnimation: null,
  setIsSecret: (isSecret) => set({ isSecret }),
  setRollMode: (rollMode) => set({ rollMode }),
  clearToast: () => set({ lastToast: null }),
  clearAnimation: () => set({ activeAnimation: null }),

  addRemoteEntry: (payload) => {
    const secretHidden = Boolean(payload.secretHidden);
    const entry: DiceHistoryEntry = {
      id: `${payload.rollerId}-${payload.timestamp}`,
      rollerName: rollerNameFor(payload.rollerId),
      label: secretHidden ? 'GM rolled (secret)' : payload.notation,
      notation: secretHidden ? '🔒 Secret roll' : payload.notation,
      results: secretHidden ? [] : payload.results,
      usedResults: secretHidden ? [] : (payload.usedResults ?? payload.results),
      droppedResults: secretHidden ? [] : (payload.droppedResults ?? []),
      total: secretHidden ? 0 : payload.total,
      isCrit: secretHidden ? false : payload.isCrit,
      isCritFail: secretHidden ? false : payload.isCritFail,
      isSecret: payload.isSecret,
      secretHidden,
      rollMode: payload.rollMode ?? 'normal',
      timestamp: payload.timestamp,
    };
    set((s) => ({
      history: [entry, ...s.history].slice(0, 50),
      lastToast: secretHidden ? entry : entry,
    }));

    if (!secretHidden && payload.results.length > 0) {
      const spec = buildDiceAnimationSpec(entry.id, {
        notation: payload.notation,
        results: payload.results,
        droppedResults: payload.droppedResults ?? [],
        rollMode: payload.rollMode ?? 'normal',
      });
      if (spec) set({ activeAnimation: spec });
    }
  },

  addDdbRollEntry: (payload) => {
    const now = Date.now();
    const recent = get().history[0];
    if (
      recent
      && recent.rollerName === payload.characterName
      && recent.total === payload.total
      && recent.label.includes(payload.label)
      && now - recent.timestamp < 2500
    ) {
      return;
    }

    const results = payload.diceResults ?? [];
    const displayLabel = `DDB: ${payload.characterName} — ${payload.label}`;
    const displayNotation = payload.notation
      ? `${displayLabel} (${payload.notation})`
      : displayLabel;
    const entry: DiceHistoryEntry = {
      id: `ddb-${Date.now()}`,
      rollerName: payload.characterName,
      label: displayLabel,
      notation: displayNotation,
      results,
      usedResults: results,
      droppedResults: [],
      total: payload.total,
      isCrit: results.some((v) => v === 20),
      isCritFail: results.length === 1 && results[0] === 1,
      isSecret: false,
      secretHidden: false,
      rollMode: 'normal',
      timestamp: Date.now(),
    };

    set((s) => ({
      history: [entry, ...s.history].slice(0, 50),
      lastToast: entry,
    }));

    if (results.length > 0) {
      const spec = buildDiceAnimationSpec(entry.id, {
        notation: payload.notation || String(payload.total),
        results,
        droppedResults: [],
        rollMode: 'normal',
      });
      if (spec) set({ activeAnimation: spec });
    } else if (payload.total) {
      // Show total-only DDB rolls (e.g. flat modifiers) without 3D dice.
      set({ activeAnimation: null });
    }
  },

  performRoll: (notation, label, options) => {
    const mode = options?.rollMode ?? get().rollMode;
    let result = options?.result;
    if (!result) {
      try {
        result = rollDice(notation, mode);
      } catch {
        return null;
      }
    }

    const { sessionId, myUserId } = useSessionStore.getState();
    const isSecret = options?.isSecret ?? get().isSecret;
    const displayLabel = label ?? normalizeNotation(notation);
    const displayNotation = label ? `${label} (${result.notation})` : result.notation;
    const animate = options?.animate !== false;

    const entry: DiceHistoryEntry = {
      id: `local-${Date.now()}`,
      rollerName: 'You',
      label: displayLabel,
      notation: displayNotation,
      results: result.results,
      usedResults: result.usedResults,
      droppedResults: result.droppedResults,
      total: result.total,
      isCrit: result.isCrit,
      isCritFail: result.isCritFail,
      isSecret,
      secretHidden: false,
      rollMode: result.rollMode,
      timestamp: Date.now(),
    };

    set((s) => ({
      history: [entry, ...s.history].slice(0, 50),
      lastToast: entry,
    }));

    if (animate) {
      const spec = buildDiceAnimationSpec(entry.id, result);
      if (spec) set({ activeAnimation: spec });
    }

    if (sessionId) {
      const payload: DiceRollPayload = {
        sessionId,
        rollerId: myUserId ?? 'unknown',
        rollerName: rollerNameFor(myUserId),
        notation: displayNotation,
        results: result.results,
        usedResults: result.usedResults,
        droppedResults: result.droppedResults,
        total: result.total,
        isSecret,
        isCrit: result.isCrit,
        isCritFail: result.isCritFail,
        rollMode: result.rollMode,
        timestamp: entry.timestamp,
      };
      getSocket().emit('dice:roll', payload);
    }

    return entry;
  },
}));

export function bindDiceSocket(): void {
  if (socketHandler) return;
  const socket = getSocket();
  socketHandler = (payload: DiceRollPayload) => {
    const { myUserId } = useSessionStore.getState();
    if (payload.rollerId === myUserId) return;
    useDiceStore.getState().addRemoteEntry(payload);
  };
  socket.on('dice:roll', socketHandler);
}

export function unbindDiceSocket(): void {
  if (!socketHandler) return;
  getSocket().off('dice:roll', socketHandler);
  socketHandler = null;
}
