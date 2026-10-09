import { ToolSection } from '@/systems/map/ToolSection';
import { LootRoller } from './LootRoller';

export function LootPanel() {
  return (
    <ToolSection id="loot" title="Loot">
      <LootRoller />
    </ToolSection>
  );
}
