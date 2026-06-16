import { useCombatStore } from './combatStore';
import { useSpellEffectStore } from '@/systems/spells/effectStore';
import { clearAllMapAreaShapes } from './aoePlacementUtils';

const GOLD = 'var(--color-accent-gold)';

/** Floating control to remove area templates and cast spell zones from the map. */
export function ClearMapAreasButton() {
  const aoePlacement = useCombatStore((s) => s.aoePlacement);
  const aoeDisplay = useCombatStore((s) => s.aoeDisplay);
  const spellZones = useSpellEffectStore((s) =>
    s.effects.filter((e) => !e.ended && e.placement && e.aoe),
  );

  const total =
    (aoeDisplay ? 1 : 0) + (aoePlacement ? 1 : 0) + spellZones.length;

  if (total === 0) return null;

  return (
    <div
      className="fixed top-28 left-1/2 -translate-x-1/2 z-[175] flex items-center gap-2 rounded-lg px-3 py-1.5 shadow-lg font-ui text-xs"
      style={{
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
      }}
    >
      <span style={{ color: 'var(--color-text-secondary)' }}>
        {total} area shape{total === 1 ? '' : 's'} on map
      </span>
      <button
        type="button"
        onClick={clearAllMapAreaShapes}
        className="px-2 py-0.5 rounded transition-all hover:opacity-90 font-semibold"
        style={{ border: `1px solid ${GOLD}`, color: GOLD }}
      >
        Clear all
      </button>
    </div>
  );
}
