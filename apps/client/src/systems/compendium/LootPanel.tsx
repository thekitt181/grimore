import { ToolSection } from '@/systems/map/ToolSection';
import { LootRoller } from './LootRoller';

export function LootPanel() {
  return (
    <ToolSection id="loot" title="Loot">
      <p className="font-ui text-[10px] leading-snug mb-2" style={{ color: 'var(--color-text-secondary)' }}>
        Level and min–max are session defaults. Set them here or on the map toolbar before the next corpse roll.
      </p>
      <LootRoller />
    </ToolSection>
  );
}
