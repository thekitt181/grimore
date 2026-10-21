import { useState } from 'react';
import { DUNGEON_PROPS, placeDungeonProp } from './dungeonProps';
import { ToolSection } from '@/systems/map/ToolSection';

export function DungeonPropsPanel() {
  const [hidden, setHidden] = useState(false);

  return (
    <ToolSection id="props" title="Props">
      <label className="flex items-center gap-2 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <input
          type="checkbox"
          checked={hidden}
          onChange={(event) => setHidden(event.target.checked)}
        />
        Place hidden
      </label>
      <div className="grid grid-cols-3 gap-1">
        {DUNGEON_PROPS.map((prop) => (
          <button
            key={prop.id}
            type="button"
            title={`Add ${prop.name}`}
            onClick={() => placeDungeonProp(prop, hidden)}
            className="flex flex-col items-center gap-0.5 rounded border border-[#2a2a3a] py-1 hover:border-[#c9a84c66] hover:bg-[#c9a84c14]"
          >
            <img
              src={prop.imageUrl}
              alt=""
              width={28}
              height={28}
              draggable={false}
              style={{ imageRendering: 'pixelated' }}
            />
            <span className="font-ui text-[9px] leading-none" style={{ color: 'var(--color-text-secondary)' }}>
              {prop.short}
            </span>
          </button>
        ))}
      </div>
      <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Click a prop to drop it on the active map, then drag it into place. Doors and gates snap to wall openings. Within 15 ft: set Reveal (e.g. Perception DC) to find hidden props, and Open (e.g. Athletics DC) to open them — two separate rolls. Use / U / VTT or D&D Beyond checks apply to the nearest matching step.
      </p>
    </ToolSection>
  );
}
