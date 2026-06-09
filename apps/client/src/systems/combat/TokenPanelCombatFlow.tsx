import { useEffect } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { previewAttackRange, useCombatStore } from './combatStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { formatActionDamage } from '@/systems/compendium/statBlockParser';
import { rollActionDamage } from './resolveAttack';
import { formatActionRangeLabel } from './attackRange';
import { evaluateAttackerConditions } from './attackConditions';
import { DamageApplyPanel } from './DamageApplyPanel';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function targetRangeStyle(inRange: boolean, rollMode: string): { border: string; opacity: number; cursor: string } {
  if (!inRange) return { border: '#ef4444', opacity: 0.55, cursor: 'not-allowed' };
  if (rollMode === 'disadvantage') return { border: '#facc15', opacity: 1, cursor: 'pointer' };
  if (rollMode === 'advantage') return { border: '#4ade80', opacity: 1, cursor: 'pointer' };
  return { border: BD, opacity: 1, cursor: 'pointer' };
}

/** Inline target picker shown at top of TokenActionsPanel. */
export function PanelTargetPicker({ token }: { token: TokenItem }) {
  const targetPick = useCombatStore((s) => s.targetPick);
  const attackBlocked = useCombatStore((s) => s.attackBlocked);
  const cancel = useCombatStore((s) => s.cancelTargetPick);
  const clearBlocked = useCombatStore((s) => s.clearAttackBlocked);
  const resolve = useCombatStore((s) => s.resolveAttackAgainstTarget);

  const tokens = useItemStore((s) =>
    Object.values(s.items).filter((i): i is TokenItem => i.type === 'token'),
  );

  useEffect(() => {
    if (!targetPick || targetPick.attackerTokenId !== token.id) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targetPick, token.id, cancel]);

  useEffect(() => {
    if (!attackBlocked) return;
    const t = window.setTimeout(clearBlocked, 4000);
    return () => window.clearTimeout(t);
  }, [attackBlocked, clearBlocked]);

  if (!targetPick || targetPick.attackerTokenId !== token.id) return null;

  const targets = tokens.filter((t) => t.id !== token.id);
  const rangeLabel = formatActionRangeLabel(targetPick.range);
  const selfCond = evaluateAttackerConditions(token);
  const selfCondNote = [
    ...selfCond.advantageReasons.map((r) => `Adv: ${r}`),
    ...selfCond.disadvantageReasons.map((r) => `Dis: ${r}`),
  ];

  return (
    <div
      className="shrink-0 mx-2 mt-2 rounded-lg overflow-hidden"
      style={{ background: 'rgba(201,168,76,0.08)', border: `1px solid ${GOLD}` }}
    >
      <div className="px-2.5 py-2 flex items-start justify-between gap-2" style={{ borderBottom: `1px solid ${BD}` }}>
        <div className="min-w-0">
          <p className="font-display text-xs" style={{ color: GOLD }}>Select target</p>
          <p className="font-ui text-[10px] mt-0.5 truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {targetPick.actionName} · To Hit {targetPick.toHit >= 0 ? '+' : ''}{targetPick.toHit}
            {rangeLabel && ` · ${rangeLabel}`}
          </p>
        </div>
        <button type="button" onClick={cancel} className="text-xs opacity-50 hover:opacity-100 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>✕</button>
      </div>

      {selfCondNote.length > 0 && (
        <p className="font-ui text-[9px] px-2.5 py-1" style={{ color: '#facc15', borderBottom: `1px solid ${BD}` }}>
          Your conditions: {selfCondNote.join(' · ')}
        </p>
      )}

      {attackBlocked && (
        <p className="font-ui text-[10px] px-2.5 py-1.5" style={{ color: '#ef4444', borderBottom: `1px solid ${BD}` }}>
          {attackBlocked.targetName}: {attackBlocked.message}
        </p>
      )}

      <p className="font-ui text-[9px] px-2.5 py-1" style={{ color: 'var(--color-text-secondary)' }}>
        Click a token on the map or choose below · red = out of range
      </p>

      <div className="max-h-40 overflow-y-auto px-2 pb-2 space-y-1">
        {targets.length === 0 && (
          <p className="font-ui text-xs text-center py-3" style={{ color: 'var(--color-text-secondary)' }}>
            No other tokens
          </p>
        )}
        {targets.map((t) => {
          const eval_ = previewAttackRange(targetPick, t);
          const style = targetRangeStyle(eval_.inRange, eval_.effectiveRollMode);
          return (
            <button
              key={t.id}
              type="button"
              disabled={!eval_.inRange}
              onClick={() => { if (eval_.inRange) resolve(t.id); }}
              className="w-full text-left rounded px-2 py-1.5 font-ui text-xs transition-colors disabled:pointer-events-none"
              style={{
                background: 'var(--color-bg-tertiary)',
                border: `1px solid ${style.border}`,
                color: 'var(--color-text-primary)',
                opacity: style.opacity,
                cursor: style.cursor,
              }}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span className="font-semibold truncate">{t.name}</span>
                <span className="shrink-0 text-[9px]" style={{ color: eval_.inRange ? 'var(--color-text-secondary)' : '#ef4444' }}>
                  {eval_.summary}
                </span>
              </div>
              <div className="text-[9px] opacity-70 mt-0.5">
                AC {t.ac ?? 10} · {t.hp}/{t.maxHp} HP
                {t.conditions.length > 0 && (
                  <span style={{ color: GOLD }}> · {t.conditions.map((c) => c.slice(0, 3)).join(', ')}</span>
                )}
              </div>
              {eval_.conditionNotes.length > 0 && (
                <div className="text-[8px] mt-0.5 leading-tight" style={{ color: '#facc15' }}>
                  {eval_.conditionNotes.join(' · ')}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Inline attack result + damage apply shown at top of TokenActionsPanel. */
export function PanelAttackResult({ token }: { token: TokenItem }) {
  const result = useCombatStore((s) => s.attackResult);
  const clear = useCombatStore((s) => s.clearAttackResult);
  const pendingDamage = useCombatStore((s) => s.pendingDamageApply);
  const setPendingDamage = useCombatStore((s) => s.setPendingDamageApply);
  const performRoll = useDiceStore((s) => s.performRoll);

  if (!result || result.attackerTokenId !== token.id) return null;

  const hitColor = result.isCrit ? GOLD : result.hit ? '#4ade80' : '#ef4444';
  const outcome = result.isCrit
    ? 'Critical hit!'
    : result.isCritFail
      ? 'Critical miss'
      : result.hit
        ? 'Hit'
        : 'Miss';

  function rollDamage(damageIndex: number) {
    const dmg = result!.damages[damageIndex];
    if (!dmg) return;
    const rolled = rollActionDamage(dmg, result!.isCrit);
    performRoll(
      rolled.notation,
      `${result!.actionName} → ${result!.targetName} (${dmg.type})`,
      { animate: true, result: rolled },
    );
    setPendingDamage({
      actionName: result!.actionName,
      damageLabel: formatActionDamage(dmg),
      damageType: dmg.type,
      baseTotal: rolled.total,
      notation: rolled.notation,
      assignments: [
        { tokenId: result!.targetTokenId, tokenName: result!.targetName, multiplier: 'normal' },
      ],
    });
  }

  const rollNote =
    result.requestedRollMode !== result.rollMode
      ? ` (rolled ${result.rollMode}, was ${result.requestedRollMode})`
      : result.rollMode !== 'normal'
        ? ` · ${result.rollMode}`
        : '';

  return (
    <div
      className="shrink-0 mx-2 mt-2 rounded-lg px-2.5 py-2"
      style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${hitColor}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-ui text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {result.actionName} → {result.targetName}
          </p>
          <p className="font-display text-base font-bold" style={{ color: hitColor }}>
            {outcome}{result.isCrit && ' ★'}
          </p>
          <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {result.attackTotal} vs AC {result.targetAc} (d20: {result.d20Used}){rollNote}
          </p>
          <p className="font-ui text-[9px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            {result.rangeSummary}
          </p>
          {result.conditionNotes.length > 0 && (
            <p className="font-ui text-[8px] mt-0.5 leading-tight" style={{ color: '#facc15' }}>
              {result.conditionNotes.join(' · ')}
            </p>
          )}
          {result.autoCritOnHit && result.hit && (
            <p className="font-ui text-[9px] mt-0.5" style={{ color: GOLD }}>Auto-crit applied</p>
          )}
        </div>
        <button type="button" onClick={clear} className="text-xs opacity-40 hover:opacity-100 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>✕</button>
      </div>

      {result.hit && result.damages.length > 0 && !pendingDamage && (
        <div className="mt-2 pt-2 space-y-1" style={{ borderTop: `1px solid ${BD}` }}>
          <p className="font-ui text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>
            Roll damage{result.isCrit ? ' (crit dice)' : ''}:
          </p>
          <div className="flex flex-wrap gap-1">
            {result.damages.map((dmg, i) => (
              <button
                key={`${dmg.dice}-${i}`}
                type="button"
                onClick={() => rollDamage(i)}
                className="font-ui text-xs px-2 py-1 rounded transition-all hover:opacity-90"
                style={{
                  background: 'rgba(239,68,68,0.15)',
                  border: '1px solid #ef4444',
                  color: '#fca5a5',
                }}
              >
                {formatActionDamage(dmg)}
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingDamage && (
        <DamageApplyPanel
          pending={pendingDamage}
          onApplied={() => { setPendingDamage(null); clear(); }}
          onCancel={() => setPendingDamage(null)}
        />
      )}

      {result.hit && result.damages.length === 0 && (
        <p className="font-ui text-[9px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>
          Hit — no damage dice parsed
        </p>
      )}
    </div>
  );
}

/** True when token panel owns the active combat flow (skip floating overlays). */
export function isTokenPanelCombatOwner(tokenId: string): boolean {
  const { tokenActionsToken, targetPick, attackResult } = useCombatStore.getState();
  if (tokenActionsToken?.id !== tokenId) return false;
  return targetPick?.attackerTokenId === tokenId || attackResult?.attackerTokenId === tokenId;
}
