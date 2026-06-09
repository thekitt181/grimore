import { useEffect } from 'react';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { previewAttackRange, useCombatStore } from './combatStore';
import { isTokenPanelCombatOwner } from './TokenPanelCombatFlow';
import { formatActionRangeLabel } from './attackRange';
import { useDdbStore } from '@/systems/ddb/ddbStore';

const GOLD = 'var(--color-accent-gold)';

export function AttackTargetPicker() {
  const targetPick = useCombatStore((s) => s.targetPick);
  const pcActionsToken = useDdbStore((s) => s.pcActionsToken);
  const sheetToken = useDdbStore((s) => s.sheetToken);
  const attackBlocked = useCombatStore((s) => s.attackBlocked);
  const cancel = useCombatStore((s) => s.cancelTargetPick);
  const clearBlocked = useCombatStore((s) => s.clearAttackBlocked);
  const resolve = useCombatStore((s) => s.resolveAttackAgainstTarget);

  const tokens = useItemStore((s) =>
    Object.values(s.items).filter((i): i is TokenItem => i.type === 'token'),
  );

  useEffect(() => {
    if (!targetPick) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [targetPick, cancel]);

  useEffect(() => {
    if (!attackBlocked) return;
    const t = window.setTimeout(clearBlocked, 4000);
    return () => window.clearTimeout(t);
  }, [attackBlocked, clearBlocked]);

  if (!targetPick) return null;
  if (isTokenPanelCombatOwner(targetPick.attackerTokenId)) return null;
  if (pcActionsToken && targetPick.attackerTokenId === pcActionsToken.id) return null;
  if (sheetToken && targetPick.attackerTokenId === sheetToken.id) return null;

  const targets = tokens.filter((t) => t.id !== targetPick.attackerTokenId);
  const rangeLabel = formatActionRangeLabel(targetPick.range);
  const subtitle = `${targetPick.attackerName} · ${targetPick.actionName} (${targetPick.toHit >= 0 ? '+' : ''}${targetPick.toHit})${rangeLabel ? ` · ${rangeLabel}` : ''}`;

  return (
    <DraggablePanel
      title="Select target"
      subtitle={subtitle}
      onClose={cancel}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 360) / 2), y: 96 }}
      width={360}
      maxHeight="70vh"
      zIndex={180}
    >
      <div className="p-2 space-y-1">
        {attackBlocked && (
          <p className="font-ui text-xs px-1 py-1" style={{ color: '#ef4444' }}>
            {attackBlocked.targetName}: {attackBlocked.message}
          </p>
        )}

        <p className="font-ui text-[10px] px-1 pb-1" style={{ color: 'var(--color-text-secondary)' }}>
          Click a token on the map, or pick below
        </p>

        {targets.length === 0 && (
          <p className="font-ui text-xs text-center py-4" style={{ color: 'var(--color-text-secondary)' }}>
            No other tokens on the map
          </p>
        )}
        {targets.map((t) => {
          const eval_ = previewAttackRange(targetPick, t);
          return (
            <button
              key={t.id}
              type="button"
              disabled={!eval_.inRange}
              onClick={() => { if (eval_.inRange) resolve(t.id); }}
              className="w-full text-left rounded px-2.5 py-2 font-ui text-xs transition-colors disabled:opacity-50"
              style={{
                background: 'var(--color-bg-tertiary)',
                border: `1px solid ${eval_.inRange ? (eval_.effectiveRollMode === 'advantage' ? '#4ade80' : eval_.effectiveRollMode === 'disadvantage' ? '#facc15' : 'var(--color-border)') : '#ef4444'}`,
                color: 'var(--color-text-primary)',
              }}
            >
              <span className="font-semibold">{t.name}</span>
              <span className="ml-2 opacity-70">{eval_.summary}</span>
              {t.conditions.length > 0 && (
                <span className="ml-1 opacity-60" style={{ color: GOLD }}>
                  [{t.conditions.map((c) => c.slice(0, 3)).join(', ')}]
                </span>
              )}
              {eval_.conditionNotes.length > 0 && (
                <div className="text-[9px] mt-0.5" style={{ color: '#facc15' }}>
                  {eval_.conditionNotes.join(' · ')}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </DraggablePanel>
  );
}
