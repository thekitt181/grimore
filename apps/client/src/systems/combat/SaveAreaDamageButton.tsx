import type { TokenItem } from '@/systems/scene/types';
import {
  formatActionDamage,
  formatAoeLabel,
  type ActionDamage,
} from '@/systems/compendium/statBlockParser';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useDiceStore } from '@/systems/dice/diceStore';
import { getMapGridSize } from './evaluateAttack';
import { tokensInAoe } from './aoeGeometry';
import { aoePlacedFor, useCombatStore } from './combatStore';
import { rollActionDamage } from './resolveAttack';
import { DamageApplyPanel } from './DamageApplyPanel';

function allTokens() {
  return Object.values(useItemStore.getState().items).filter(
    (i): i is TokenItem => i.type === 'token',
  );
}

export function SaveAreaDamageButton({
  effectName,
  damage,
  token,
  aoe,
  save,
}: {
  effectName: string;
  damage: ActionDamage;
  token: TokenItem;
  aoe?: { size: number; type: string };
  save?: { dc: number; stat: string };
}) {
  const performRoll = useDiceStore((s) => s.performRoll);
  const pending = useCombatStore((s) => s.pendingDamageApply);
  const setPending = useCombatStore((s) => s.setPendingDamageApply);
  const aoeDisplay = useCombatStore((s) => s.aoeDisplay);

  const damageLabel = formatActionDamage(damage);
  const needsPlacement = Boolean(aoe);
  const placed = needsPlacement ? aoePlacedFor(token.id, effectName) : null;
  const canRoll = !needsPlacement || Boolean(placed);

  const ownsPending =
    pending?.sourceTokenId === token.id &&
    pending.actionName === effectName &&
    pending.damageLabel === damageLabel;

  function rollDamage() {
    if (!canRoll) return;

    const rolled = rollActionDamage(damage, false);
    const aoeLabel = aoe ? formatAoeLabel(aoe) : undefined;
    performRoll(
      rolled.notation,
      `${effectName} · ${damageLabel}${aoeLabel ? ` · ${aoeLabel}` : ''}`,
      { animate: true, result: rolled },
    );

    const display = placed ?? (aoeDisplay?.sourceTokenId === token.id ? aoeDisplay : null);
    const assignments =
      display && aoe
        ? tokensInAoe(allTokens(), display.aoe, display.placement, getMapGridSize(), token.id).map(
            (t) => ({ tokenId: t.id, tokenName: t.name, multiplier: 'normal' as const }),
          )
        : [];

    setPending({
      actionName: effectName,
      damageLabel,
      damageType: damage.type,
      baseTotal: rolled.total,
      notation: rolled.notation,
      assignments,
      isSaveEffect: true,
      sourceTokenId: token.id,
      ...(save?.dc !== undefined ? { saveDc: save.dc } : {}),
      ...(save?.stat ? { saveStat: save.stat } : {}),
      ...(aoe ? { aoe } : {}),
    });
  }

  if (ownsPending && pending) {
    return (
      <DamageApplyPanel
        pending={pending}
        onApplied={() => setPending(null)}
        onCancel={() => setPending(null)}
      />
    );
  }

  return (
    <div className="space-y-1">
      {!canRoll && needsPlacement && (
        <p className="font-ui text-[9px] text-center" style={{ color: 'var(--color-text-secondary)' }}>
          Move the preview on the map, then click the map to confirm
        </p>
      )}
      <button
        type="button"
        onClick={rollDamage}
        disabled={!canRoll}
        className="font-ui text-xs px-2 py-1 rounded transition-all hover:opacity-90 w-full disabled:opacity-40 disabled:cursor-not-allowed"
        style={{
          background: 'rgba(239,68,68,0.15)',
          border: '1px solid #ef4444',
          color: '#fca5a5',
        }}
      >
        Roll {damageLabel}
      </button>
    </div>
  );
}
