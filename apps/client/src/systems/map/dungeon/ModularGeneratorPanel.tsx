import { useState } from 'react';
import { ToolSection } from '@/systems/map/ToolSection';
import type { DoorStyle, DungeonMotif, DungeonSize, FurnishingStyle } from './generateDungeon';
import { placeModularDungeon } from './placeModularDungeon';
import { clampPartyLevel, partyLevelFromTokens } from '@/systems/combat/partyLevel';
import type { ModularKitMode, ModularLayout } from './generateModularDungeon';

const KITS: Array<{ id: ModularKitMode; label: string }> = [
  { id: 'kenney', label: 'Kenney' },
  { id: 'both', label: 'Kenney + KayKit' },
];

const LAYOUTS: Array<{ id: ModularLayout; label: string }> = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'hub', label: 'Hub' },
  { id: 'gauntlet', label: 'Gauntlet' },
];

const SIZES: Array<{ id: DungeonSize; label: string }> = [
  { id: 'tiny', label: 'XS' },
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
  { id: 'huge', label: 'XL' },
];

const DOORS: Array<{ id: DoorStyle; label: string }> = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Shut' },
];

const FURNISH: Array<{ id: FurnishingStyle; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'light', label: 'Light' },
  { id: 'full', label: 'Full' },
];

const MOTIFS: Array<{ id: DungeonMotif; label: string; text: string }> = [
  { id: 'mixed', label: 'Mixed', text: '' },
  { id: 'crypt', label: 'Crypt', text: 'undead crypt of sealed tombs and restless dead' },
  { id: 'temple', label: 'Temple', text: 'ruined temple, cultists, and a forgotten altar' },
  { id: 'fortress', label: 'Fortress', text: 'occupied fortress, soldiers, and a warband hold' },
  { id: 'mine', label: 'Mine', text: 'underdark mine, kobolds, and a collapsed shaft' },
  { id: 'ruin', label: 'Ruin', text: 'overgrown ruin, oozes, spiders, and collapsed halls' },
];

function ChoiceRow<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (id: T) => void;
}) {
  return (
    <div className="space-y-1">
      <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            className={`min-w-[2.4rem] flex-1 text-xs py-1 rounded font-ui transition-all ${
              value === option.id
                ? 'bg-[#c9a84c22] text-[#c9a84c] ring-1 ring-[#c9a84c44]'
                : 'text-[#8a8075] border border-[#2a2a3a] hover:text-[#e8e0d0]'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function ModularGeneratorPanel() {
  const [kit, setKit] = useState<ModularKitMode>('kenney');
  const [layout, setLayout] = useState<ModularLayout>('rooms');
  const [size, setSize] = useState<DungeonSize>('medium');
  const [furnishings, setFurnishings] = useState<FurnishingStyle>('full');
  const [monsters, setMonsters] = useState(true);
  const [partyLevel, setPartyLevel] = useState(() => partyLevelFromTokens() ?? 3);
  const [doors, setDoors] = useState<DoorStyle>('mixed');
  const [stairs, setStairs] = useState(true);
  const [motif, setMotif] = useState<DungeonMotif>('mixed');
  const [themeText, setThemeText] = useState('');
  const [seedText, setSeedText] = useState('');
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    if (busy) return;
    setBusy(true);
    const parsed = Number(seedText.trim());
    const seed = seedText.trim() !== '' && Number.isFinite(parsed)
      ? (parsed >>> 0)
      : (Math.random() * 0xffffffff) >>> 0;
    try {
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      await placeModularDungeon({
        kit,
        layout,
        size,
        furnishings,
        doors,
        stairs,
        motif,
        seed,
        ...(themeText.trim() ? { theme: themeText.trim() } : {}),
      }, { monsters, partyLevel });
      setLastSeed(seed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolSection id="modular-dungeon" title="Modular dungeon">
      <ChoiceRow label="Kit" value={kit} options={KITS} onChange={setKit} />
      <ChoiceRow label="Layout" value={layout} options={LAYOUTS} onChange={setLayout} />
      <ChoiceRow label="Size" value={size} options={SIZES} onChange={setSize} />
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Theme</span>
        <textarea
          className="input-dark w-full text-xs py-1 min-h-[4.5rem] resize-y"
          placeholder="Write the place — e.g. drowned yuan-ti temple in a mangrove, cultists and snakes"
          maxLength={280}
          value={themeText}
          onChange={(event) => setThemeText(event.target.value)}
        />
      </label>
      <ChoiceRow
        label="Start from"
        value={motif}
        options={MOTIFS}
        onChange={(id) => {
          setMotif(id);
          const starter = MOTIFS.find((option) => option.id === id)?.text ?? '';
          setThemeText(starter);
        }}
      />
      <ChoiceRow label="Doors" value={doors} options={DOORS} onChange={setDoors} />
      <ChoiceRow label="Furnishings" value={furnishings} options={FURNISH} onChange={setFurnishings} />
      <label className="flex items-center gap-2 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <input type="checkbox" checked={monsters} onChange={(e) => setMonsters(e.target.checked)} />
        Place monsters from the codex
      </label>
      {monsters && (
        <label className="block space-y-1">
          <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Party level</span>
          <input
            className="input-dark w-full text-xs py-1"
            inputMode="numeric"
            min={1}
            max={20}
            value={partyLevel}
            onChange={(event) => setPartyLevel(clampPartyLevel(Number(event.target.value)))}
          />
        </label>
      )}
      <label className="flex items-center gap-2 font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        <input type="checkbox" checked={stairs} onChange={(e) => setStairs(e.target.checked)} />
        Stairs
      </label>
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Seed</span>
        <input
          className="input-dark w-full text-xs py-1"
          inputMode="numeric"
          placeholder="Blank for a new map"
          value={seedText}
          onChange={(event) => setSeedText(event.target.value.replace(/[^\d]/g, ''))}
        />
      </label>
      <button type="button" className="btn-primary w-full text-xs py-1.5" onClick={() => { void generate(); }} disabled={busy}>
        {busy ? 'Generating…' : 'Generate modular'}
      </button>
      {lastSeed != null && (
        <button
          type="button"
          className="font-ui text-xs w-full text-left"
          style={{ color: 'var(--color-text-secondary)' }}
          onClick={() => setSeedText(String(lastSeed))}
          title="Fill the seed box so the next map matches this one"
        >
          Seed {lastSeed}. Click to reuse it.
        </button>
      )}
      <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Pieces snap on a 4 m Kenney grid so rooms and halls meet with no gaps.
        KayKit adds rim walls; corridor floors stay Kenney. Furnishings use the same chests and props as the 2D generator. Theme and party level pick the encounters.
      </p>
    </ToolSection>
  );
}
