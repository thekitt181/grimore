import { useEffect } from 'react';
import { useCombatStore } from './combatStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { formatActionDamage } from '@/systems/compendium/statBlockParser';
import { rollActionDamage } from './resolveAttack';
import { isTokenPanelCombatOwner } from './TokenPanelCombatFlow';
import { DamageApplyPanel } from './DamageApplyPanel';

const GOLD = 'var(--color-accent-gold)';

export function CombatResultToast() {
  const result = useCombatStore((s) => s.attackResult);
  const clear = useCombatStore((s) => s.clearAttackResult);
  const pendingDamage = useCombatStore((s) => s.pendingDamageApply);
  const setPendingDamage = useCombatStore((s) => s.setPendingDamageApply);
  const performRoll = useDiceStore((s) => s.performRoll);

  useEffect(() => {
    if (!result) return;
    // Hits needing damage stay open until the user applies or dismisses manually.
    if (result.hit && result.damages.length > 0) return;
    if (pendingDamage) return;
    const t = window.setTimeout(clear, 5000);
    return () => window.clearTimeout(t);
  }, [result, clear, pendingDamage]);

  if (!result) return null;
  if (isTokenPanelCombatOwner(result.attackerTokenId)) return null;

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
      `${result!.actionName} damage → ${result!.targetName} (${dmg.type})`,
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

  return (
    <div
      className="fixed bottom-36 left-1/2 -translate-x-1/2 z-[190] rounded-lg px-4 py-3 shadow-2xl max-w-sm w-[min(100vw-2rem,22rem)]"
      style={{
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${hitColor}`,
      }}
    >
      <button
        type="button"
        onClick={clear}
        className="absolute top-1.5 right-2 text-xs opacity-40 hover:opacity-100"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        ✕
      </button>

      <div className="font-ui text-xs pr-4" style={{ color: 'var(--color-text-secondary)' }}>
        {result.attackerName} · {result.actionName}
      </div>
      <div className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        vs {result.targetName} (AC {result.targetAc})
      </div>

      <div className="font-display text-xl font-bold text-center my-1" style={{ color: hitColor }}>
        {outcome}
        {result.isCrit && ' ★'}
      </div>

      <div className="font-ui text-xs text-center mb-2" style={{ color: 'var(--color-text-secondary)' }}>
        Attack {result.attackTotal} (d20: {result.d20Used})
        {result.rollMode !== 'normal' && ` · ${result.rollMode}`}
        {result.requestedRollMode !== result.rollMode && result.requestedRollMode !== 'normal' && (
          <span> (was {result.requestedRollMode})</span>
        )}
      </div>
      <div className="font-ui text-[10px] text-center mb-2" style={{ color: 'var(--color-text-secondary)' }}>
        {result.rangeSummary}
        {result.rangeWarnings.length > 0 && (
          <span style={{ color: '#facc15' }}> · {result.rangeWarnings.join(' · ')}</span>
        )}
      </div>

      {result.hit && result.damages.length > 0 && !pendingDamage && (
        <div className="space-y-1 pt-1" style={{ borderTop: '1px solid var(--color-border)' }}>
          <p className="font-ui text-[10px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
            Roll damage vs {result.targetName}
            {result.isCrit && ' (crit dice)'}
          </p>
          <div className="flex flex-wrap gap-1 justify-center">
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
        <p className="font-ui text-xs text-center" style={{ color: 'var(--color-text-secondary)' }}>
          No damage parsed for this action — roll manually
        </p>
      )}
    </div>
  );
}
