import { formatAoeLabel } from '@/systems/compendium/statBlockParser';
import { aoeActionNamesMatch } from './aoePlacementUtils';
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
  const cancel = useCombatStore((s) => s.cancelAoePlacement);
  const clearShapes = useCombatStore((s) => s.clearMapAoeShapes);
  const placing = useCombatStore((s) => s.aoePlacement);
  const display = useCombatStore((s) => s.aoeDisplay);

  const label = formatAoeLabel(aoe);
  const isPlacing =
    placing?.sourceTokenId === sourceTokenId && aoeActionNamesMatch(placing.actionName, actionName);
  const isPlaced =
    display?.sourceTokenId === sourceTokenId && aoeActionNamesMatch(display.actionName, actionName);

  function place() {
    if (isPlacing) {
      cancel();
      return;
    }
    begin({
      sourceTokenId,
      sourceTokenName,
      actionName,
      aoe,
    });
  }

  return (
    <div className="space-y-1">
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
        title={
          isPlacing
            ? 'Click the map to confirm · click again to cancel'
            : isPlaced
              ? 'Click to reposition on map'
              : 'Place area on map before rolling'
        }
      >
        {isPlacing ? `Placing ${label} — click map` : isPlaced ? `✓ ${label} on map` : `Place ${label} on map`}
      </button>
      {isPlaced && (
        <button
          type="button"
          onClick={clearShapes}
          className="font-ui text-[10px] w-full text-center px-2 py-1 rounded transition-all hover:opacity-90"
          style={{
            border: `1px solid ${BD}`,
            color: 'var(--color-text-secondary)',
          }}
        >
          Clear area from map
        </button>
      )}
    </div>
  );
}
