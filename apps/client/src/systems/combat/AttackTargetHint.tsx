import { useCombatStore } from './combatStore';
import { isTokenPanelCombatOwner } from './TokenPanelCombatFlow';

/** Brief hint while target pick mode is active. */
export function AttackTargetHint() {
  const targetPick = useCombatStore((s) => s.targetPick);
  if (!targetPick) return null;
  if (isTokenPanelCombatOwner(targetPick.attackerTokenId)) return null;

  return (
    <div
      className="fixed top-16 left-1/2 -translate-x-1/2 z-[175] rounded-lg px-3 py-1.5 shadow-lg pointer-events-none font-ui text-xs"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-accent-gold)',
        color: 'var(--color-accent-gold)',
      }}
    >
      Click a target token · Esc to cancel
    </div>
  );
}
