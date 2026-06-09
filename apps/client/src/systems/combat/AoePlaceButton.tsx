import { formatAoeLabel } from '@/systems/compendium/statBlockParser';
import { useCombatStore } from './combatStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function AoePlaceButton({
  sourceTokenId,
  sourceTokenName,
  actionName,
  aoe,
}: {
  sourceTokenId: string;
  sourceTokenName: string;
  actionName: string;
  aoe: { size: number; type: string };
}) {
  const begin = useCombatStore((s) => s.beginAoePlacement);
  const placing = useCombatStore((s) => s.aoePlacement);
  const display = useCombatStore((s) => s.aoeDisplay);

  const label = formatAoeLabel(aoe);
  const isPlacing =
    placing?.sourceTokenId === sourceTokenId && placing.actionName === actionName;
  const isPlaced =
    display?.sourceTokenId === sourceTokenId && display.actionName === actionName;

  function place() {
    begin({
      sourceTokenId,
      sourceTokenName,
      actionName,
      aoe,
    });
  }

  return (
    <button
      type="button"
      onClick={place}
      className="font-ui text-[10px] w-full text-center px-2 py-1.5 rounded transition-all hover:opacity-90 font-semibold"
      style={{
        background: isPlacing
          ? 'rgba(239,68,68,0.25)'
          : isPlaced
            ? 'rgba(74,222,128,0.12)'
            : 'rgba(201,168,76,0.12)',
        border: `1px solid ${isPlacing ? '#ef4444' : isPlaced ? '#4ade80' : GOLD}`,
        color: isPlacing ? '#fca5a5' : isPlaced ? '#4ade80' : GOLD,
      }}
      title={isPlaced ? 'Click to reposition on map' : 'Place area on map before rolling'}
    >
      {isPlacing ? `Placing ${label}…` : isPlaced ? `✓ ${label} on map` : `Place ${label} on map`}
    </button>
  );
}
