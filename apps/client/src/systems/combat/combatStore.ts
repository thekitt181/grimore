import { create } from 'zustand';
import type { RollMode } from '@grimoire/dice-engine';
import type { ActionDamage, ActionRange } from '@/systems/compendium/statBlockParser';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { rollAttack, resolveAttackVsAc } from './resolveAttack';
import { evaluateAttack, getMapGridSize } from './evaluateAttack';
import { evaluateAttackerConditions } from './attackConditions';
import type { PendingDamageApply } from './DamageApplyPanel';
import { itemCenter } from '@/systems/scene/types';
import { placementFromCursor, type AoePlacement } from './aoeGeometry';

export interface AttackSetup {
  attackerTokenId: string;
  attackerName: string;
  actionName: string;
  toHit: number;
  damages: ActionDamage[];
  range: ActionRange;
  rollMode: RollMode;
  isSecret: boolean;
}

export interface AttackResult {
  id: string;
  actionName: string;
  attackerName: string;
  attackerTokenId: string;
  targetTokenId: string;
  targetName: string;
  targetAc: number;
  attackTotal: number;
  d20Used: number;
  hit: boolean;
  isCrit: boolean;
  isCritFail: boolean;
  damages: ActionDamage[];
  rollMode: RollMode;
  requestedRollMode: RollMode;
  notation: string;
  isSecret: boolean;
  distanceFt: number;
  rangeSummary: string;
  rangeWarnings: string[];
  conditionNotes: string[];
  autoCritOnHit: boolean;
}

export interface AoePlacementSetup {
  sourceTokenId: string;
  sourceTokenName: string;
  actionName: string;
  aoe: { size: number; type: string };
}

export interface AoeDisplayState {
  sourceTokenId: string;
  aoe: { size: number; type: string };
  placement: AoePlacement;
  actionName: string;
}

interface CombatState {
  targetPick: AttackSetup | null;
  attackResult: AttackResult | null;
  pendingDamageApply: PendingDamageApply | null;
  aoePlacement: AoePlacementSetup | null;
  aoeDisplay: AoeDisplayState | null;
  attackBlocked: { message: string; targetName: string } | null;
  tokenActionsToken: TokenItem | null;
  beginTargetedAttack: (
    setup: Omit<AttackSetup, 'rollMode' | 'isSecret' | 'range'> &
      Partial<Pick<AttackSetup, 'rollMode' | 'isSecret'>> &
      { range?: ActionRange },
  ) => void;
  cancelTargetPick: () => void;
  resolveAttackAgainstTarget: (targetTokenId: string) => AttackResult | null;
  clearAttackResult: () => void;
  setPendingDamageApply: (pending: PendingDamageApply | null) => void;
  beginAoePlacement: (setup: AoePlacementSetup) => void;
  cancelAoePlacement: () => void;
  confirmAoePlacement: (cursorX: number, cursorY: number) => void;
  clearAoeDisplay: () => void;
  clearAttackBlocked: () => void;
  openTokenActions: (token: TokenItem) => void;
  closeTokenActions: () => void;
}

const DEFAULT_RANGE: ActionRange = { kind: 'melee', reachFt: 5 };

function tokenAc(token: TokenItem): number {
  return token.ac ?? 10;
}

function allTokens(): TokenItem[] {
  return Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token',
  );
}

export const useCombatStore = create<CombatState>((set, get) => ({
  targetPick: null,
  attackResult: null,
  pendingDamageApply: null,
  aoePlacement: null,
  aoeDisplay: null,
  attackBlocked: null,
  tokenActionsToken: null,

  beginTargetedAttack: (setup) => {
    const dice = useDiceStore.getState();
    const attacker = useItemStore.getState().items[setup.attackerTokenId];
    if (attacker?.type === 'token') {
      const att = evaluateAttackerConditions(attacker);
      if (att.blockReason) {
        set({
          attackBlocked: { message: att.blockReason, targetName: setup.attackerName },
          targetPick: null,
          attackResult: null,
          pendingDamageApply: null,
        });
        return;
      }
    }
    set({
      targetPick: {
        ...setup,
        range: setup.range ?? DEFAULT_RANGE,
        rollMode: setup.rollMode ?? dice.rollMode,
        isSecret: setup.isSecret ?? dice.isSecret,
      },
      attackResult: null,
      pendingDamageApply: null,
      attackBlocked: null,
    });
  },

  cancelTargetPick: () => set({ targetPick: null }),

  resolveAttackAgainstTarget: (targetTokenId) => {
    const pick = get().targetPick;
    if (!pick || pick.attackerTokenId === targetTokenId) return null;

    const attacker = useItemStore.getState().items[pick.attackerTokenId];
    const target = useItemStore.getState().items[targetTokenId];
    if (!attacker || attacker.type !== 'token' || !target || target.type !== 'token') return null;

    const attackEval = evaluateAttack(
      attacker,
      target,
      pick.range,
      allTokens(),
      pick.rollMode,
      getMapGridSize(),
    );

    if (!attackEval.inRange) {
      set({
        attackBlocked: {
          message: attackEval.blockReason ?? 'Out of range',
          targetName: target.name,
        },
      });
      return null;
    }

    const rollMode = attackEval.effectiveRollMode;
    const rolled = rollAttack(pick.toHit, rollMode);
    const ac = tokenAc(target);
    let { hit, isCrit, isCritFail } = resolveAttackVsAc(rolled.d20Used, rolled.total, ac);
    if (hit && attackEval.autoCritOnHit) isCrit = true;

    const label = `${pick.actionName} → ${target.name}`;
    const outcome = hit
      ? isCrit ? 'CRIT!' : 'Hit'
      : isCritFail ? 'Critical miss' : 'Miss';
    const notes = attackEval.warnings.length > 0 ? ` · ${attackEval.warnings.join('; ')}` : '';
    const detail = `${rolled.total} vs AC ${ac} · ${attackEval.summary} · ${outcome}${notes}`;

    useDiceStore.getState().performRoll(
      rolled.notation,
      `${label} (${detail})`,
      { rollMode, isSecret: pick.isSecret, animate: true, result: rolled },
    );

    const result: AttackResult = {
      id: `attack-${Date.now()}`,
      actionName: pick.actionName,
      attackerName: pick.attackerName,
      attackerTokenId: pick.attackerTokenId,
      targetTokenId,
      targetName: target.name,
      targetAc: ac,
      attackTotal: rolled.total,
      d20Used: rolled.d20Used,
      hit,
      isCrit,
      isCritFail,
      damages: pick.damages,
      rollMode,
      requestedRollMode: pick.rollMode,
      notation: rolled.notation,
      isSecret: pick.isSecret,
      distanceFt: attackEval.distanceFt,
      rangeSummary: attackEval.summary,
      rangeWarnings: attackEval.warnings,
      conditionNotes: attackEval.conditionNotes,
      autoCritOnHit: attackEval.autoCritOnHit,
    };

    set({ targetPick: null, attackResult: result, attackBlocked: null, pendingDamageApply: null });
    return result;
  },

  clearAttackResult: () => set({ attackResult: null, pendingDamageApply: null, aoeDisplay: null }),

  setPendingDamageApply: (pending) =>
    set({ pendingDamageApply: pending, ...(pending === null ? { aoeDisplay: null } : {}) }),

  beginAoePlacement: (setup) =>
    set({
      aoePlacement: setup,
      targetPick: null,
      attackBlocked: null,
      aoeDisplay: null,
    }),

  cancelAoePlacement: () => set({ aoePlacement: null }),

  confirmAoePlacement: (cursorX, cursorY) => {
    const setup = get().aoePlacement;
    if (!setup) return;

    const source = useItemStore.getState().items[setup.sourceTokenId];
    if (!source || source.type !== 'token') {
      set({ aoePlacement: null });
      return;
    }

    const { cx, cy } = itemCenter(source);
    const placement = placementFromCursor(setup.aoe, cx, cy, cursorX, cursorY);

    set({
      aoePlacement: null,
      aoeDisplay: {
        sourceTokenId: setup.sourceTokenId,
        aoe: setup.aoe,
        placement,
        actionName: setup.actionName,
      },
    });
  },

  clearAoeDisplay: () => set({ aoeDisplay: null }),

  clearAttackBlocked: () => set({ attackBlocked: null }),

  openTokenActions: (token) => set({ tokenActionsToken: token }),
  closeTokenActions: () => set({ tokenActionsToken: null }),
}));

/** Confirmed AoE on the map for a given action (if any). */
export function aoePlacedFor(sourceTokenId: string, actionName: string): AoeDisplayState | null {
  const d = useCombatStore.getState().aoeDisplay;
  if (d && d.sourceTokenId === sourceTokenId && d.actionName === actionName) return d;
  return null;
}

/** Preview range for a target while picking (UI helper). */
export function previewAttackRange(
  pick: AttackSetup,
  target: TokenItem,
): ReturnType<typeof evaluateAttack> {
  const attacker = useItemStore.getState().items[pick.attackerTokenId];
  if (!attacker || attacker.type !== 'token') {
    return {
      distanceFt: 0,
      inRange: true,
      effectiveKind: 'unknown',
      autoDisadvantage: false,
      effectiveRollMode: pick.rollMode,
      summary: '—',
      warnings: [],
      autoCritOnHit: false,
      conditionNotes: [],
    };
  }
  return evaluateAttack(
    attacker,
    target,
    pick.range,
    allTokens(),
    pick.rollMode,
    getMapGridSize(),
  );
}
