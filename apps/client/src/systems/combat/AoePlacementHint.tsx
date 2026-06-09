import { formatAoeLabel } from '@/systems/compendium/statBlockParser';
import { isDirectedAoe } from './aoeGeometry';
import { useCombatStore } from './combatStore';

const GOLD = 'var(--color-accent-gold)';

/** Map hint while placing a save-effect area. */
export function AoePlacementHint() {
  const setup = useCombatStore((s) => s.aoePlacement);
  if (!setup) return null;

  const label = formatAoeLabel(setup.aoe);
  const directed = isDirectedAoe(setup.aoe.type);

  return (
    <div
      className="fixed top-16 left-1/2 -translate-x-1/2 z-[175] rounded-lg px-3 py-1.5 shadow-lg pointer-events-none font-ui text-xs"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid #ef4444',
        color: '#fca5a5',
      }}
    >
      <span className="font-semibold" style={{ color: GOLD }}>{setup.actionName}</span>
      <span className="mx-1 opacity-50">·</span>
      {label}
      <span className="mx-1 opacity-50">·</span>
      {directed ? 'Aim from token · click to place' : 'Move area · click to place'}
      <span className="mx-1 opacity-50">·</span>
      Esc to cancel
    </div>
  );
}
