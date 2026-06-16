import { useMemo } from 'react';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import {
  countTargetAllocations,
  summarizeTargetAllocations,
  useSpellEffectTargetStore,
} from './spellEffectTargetStore';
import { cancelSpellTargetPick, finishSpellTargetPick, confirmSingleSpellTarget } from './pickSpellTargets';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

/** Banner while picking spell targets on the map. */
export function SpellTargetHint() {
  const pick = useSpellEffectTargetStore((s) => s.pick);
  const addTargetAllocation = useSpellEffectTargetStore((s) => s.addTargetAllocation);
  const removeTargetAllocation = useSpellEffectTargetStore((s) => s.removeTargetAllocation);
  const toggleTarget = useSpellEffectTargetStore((s) => s.toggleTarget);
  const items = useItemStore((s) => s.items);

  const targets = useMemo(() => {
    if (!pick) return [];
    return Object.values(items).filter(
      (i): i is TokenItem => i.type === 'token' && i.visible !== false && i.id !== pick.casterTokenId,
    );
  }, [items, pick]);

  if (!pick) return null;

  const assigned = pick.selectedTargetIds.length;
  const total = pick.projectileCount ?? pick.maxTargets;
  const multi = pick.maxTargets > 1;
  const repeatMode = Boolean(pick.allowRepeatTargets);
  const nameById = (id: string) => {
    const item = items[id];
    return item?.type === 'token' ? item.name : null;
  };
  const summary = assigned > 0 ? summarizeTargetAllocations(pick.selectedTargetIds, nameById) : '';
  const allAssigned = repeatMode ? assigned === total : assigned > 0;

  function selectFromList(tokenId: string) {
    if (multi) {
      if (repeatMode) {
        addTargetAllocation(tokenId);
        return;
      }
      toggleTarget(tokenId);
      return;
    }
    confirmSingleSpellTarget(tokenId);
  }

  return (
    <div
      className="fixed top-16 left-1/2 -translate-x-1/2 z-[175] rounded-lg px-3 py-2 shadow-lg font-ui text-xs flex flex-col gap-2 items-center max-w-sm pointer-events-none"
      style={{
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${GOLD}`,
        color: 'var(--color-text-primary)',
      }}
    >
      <p style={{ color: GOLD }}>
        {pick.spellName} ·{' '}
        {repeatMode
          ? `Assign ${total} missile${total === 1 ? '' : 's'} (${assigned}/${total})`
          : multi
            ? `Pick up to ${pick.maxTargets} targets (${assigned}/${pick.maxTargets})`
            : 'Pick a target'}
      </p>
      <p className="text-[10px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
        {repeatMode
          ? 'Click a portrait mini to add a missile — large bases won’t steal clicks. Use +/− or the list below.'
          : 'Click a token on the map or choose below'}
      </p>
      {summary && (
        <p className="text-[10px] truncate w-full text-center" style={{ color: 'var(--color-text-secondary)' }}>
          {summary}
        </p>
      )}

      {targets.length > 0 && (
        <div className="flex flex-col gap-1 w-full max-h-32 overflow-y-auto pointer-events-auto">
          {targets.map((t) => {
            const count = countTargetAllocations(pick.selectedTargetIds, t.id);
            const selected = count > 0;
            return (
              <div key={t.id} className="flex items-center gap-1">
                {repeatMode && (
                  <button
                    type="button"
                    onClick={() => removeTargetAllocation(t.id)}
                    disabled={count === 0}
                    className="font-ui text-[10px] w-6 h-6 rounded shrink-0 disabled:opacity-30"
                    style={{ border: `1px solid ${BD}`, color: 'var(--color-text-secondary)' }}
                    aria-label={`Remove missile from ${t.name}`}
                  >
                    −
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => selectFromList(t.id)}
                  disabled={repeatMode && assigned >= total}
                  className="font-ui text-[10px] px-2 py-1 rounded text-left flex-1 transition-opacity hover:opacity-90 disabled:opacity-40"
                  style={{
                    background: selected ? 'rgba(201,168,76,0.2)' : 'var(--color-bg-primary)',
                    border: `1px solid ${selected ? GOLD : 'var(--color-border)'}`,
                    color: 'var(--color-text-primary)',
                  }}
                >
                  {t.name}
                  {repeatMode && count > 0 && (
                    <span className="ml-1" style={{ color: GOLD }}>×{count}</span>
                  )}
                  {t.locked && <span className="ml-1 opacity-60">(locked)</span>}
                </button>
                {repeatMode && (
                  <button
                    type="button"
                    onClick={() => addTargetAllocation(t.id)}
                    disabled={assigned >= total}
                    className="font-ui text-[10px] w-6 h-6 rounded shrink-0 disabled:opacity-30"
                    style={{ border: `1px solid ${GOLD}`, color: GOLD }}
                    aria-label={`Add missile to ${t.name}`}
                  >
                    +
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex gap-2 pointer-events-auto">
        {multi && (
          <button
            type="button"
            className="font-ui text-[10px] px-2 py-1 rounded"
            style={{
              background: 'rgba(201,168,76,0.2)',
              border: `1px solid ${GOLD}`,
              color: GOLD,
            }}
            disabled={!allAssigned}
            onClick={() => finishSpellTargetPick(pick.selectedTargetIds)}
          >
            {repeatMode ? `Cast (${assigned}/${total})` : `Cast (${assigned})`}
          </button>
        )}
        <button
          type="button"
          className="font-ui text-[10px] px-2 py-1 rounded opacity-80"
          style={{ border: '1px solid var(--color-border)' }}
          onClick={() => cancelSpellTargetPick()}
        >
          Cancel
        </button>
      </div>
      <p className="text-[9px] opacity-60">Esc to cancel{repeatMode ? ' · right-click map token to remove' : ''}</p>
    </div>
  );
}
