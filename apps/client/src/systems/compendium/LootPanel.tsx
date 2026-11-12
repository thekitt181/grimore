import { ToolSection } from '@/systems/map/ToolSection';
import { LootDefaultsFields } from '@/systems/combat/LootDefaultsFields';
import { LootRoller } from './LootRoller';

export function LootPanel() {
  return (
    <ToolSection id="loot" title="Loot" startOpen>
      <div
        className="space-y-2 rounded-md p-2"
        style={{ border: '1px solid var(--color-accent-gold)', background: 'rgba(201,168,76,0.08)' }}
      >
        <p className="font-display text-[11px] font-semibold tracking-wider uppercase" style={{ color: 'var(--color-accent-gold)' }}>
          All loot
        </p>
        <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
          Level and min–max apply to every corpse and loot roll until you change them.
        </p>
        <LootDefaultsFields />
      </div>
      <LootRoller />
    </ToolSection>
  );
}
