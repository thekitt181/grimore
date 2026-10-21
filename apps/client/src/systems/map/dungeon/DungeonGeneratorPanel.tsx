import { useState } from 'react';
import {
  type CavernOpenness,
  type ChamberScale,
  type CorridorStyle,
  type DeadEndStyle,
  type DoorStyle,
  type DungeonLayout,
  type DungeonMotif,
  type DungeonSize,
  type FurnishingStyle,
  type KeyDetail,
  type PassageStyle,
  type RoomDensity,
  type SecretStyle,
  type StairsStyle,
} from './generateDungeon';
import { placeDungeonFloors } from './placeGeneratedDungeon';
import { ToolSection } from '@/systems/map/ToolSection';

const LAYOUTS: Array<{ id: DungeonLayout; label: string }> = [
  { id: 'rooms', label: 'Rooms' },
  { id: 'five-room', label: '5-room' },
  { id: 'hub', label: 'Hub' },
  { id: 'gauntlet', label: 'Gauntlet' },
  { id: 'cavern', label: 'Cavern' },
];

const SIZES: Array<{ id: DungeonSize; label: string }> = [
  { id: 'tiny', label: 'XS' },
  { id: 'small', label: 'S' },
  { id: 'medium', label: 'M' },
  { id: 'large', label: 'L' },
  { id: 'huge', label: 'XL' },
  { id: 'vast', label: '2XL' },
  { id: 'mega', label: '3XL' },
];

const CHAMBERS: Array<{ id: ChamberScale; label: string }> = [
  { id: 'cramped', label: 'Cramped' },
  { id: 'normal', label: 'Normal' },
  { id: 'grand', label: 'Grand' },
];

const DOORS: Array<{ id: DoorStyle; label: string }> = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'open', label: 'Open' },
  { id: 'closed', label: 'Shut' },
  { id: 'locked', label: 'Locked' },
];

const SECRETS: Array<{ id: SecretStyle; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'few', label: 'Few' },
  { id: 'many', label: 'Many' },
];

const CORRIDORS: Array<{ id: CorridorStyle; label: string }> = [
  { id: 'straight', label: 'Straight' },
  { id: 'winding', label: 'Winding' },
  { id: 'wide', label: 'Wide' },
];

const PASSAGES: Array<{ id: PassageStyle; label: string }> = [
  { id: 'sparse', label: 'Sparse' },
  { id: 'linked', label: 'Linked' },
  { id: 'maze', label: 'Maze' },
];

const DEAD_ENDS: Array<{ id: DeadEndStyle; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'few', label: 'Few' },
  { id: 'many', label: 'Many' },
];

const STAIRS: Array<{ id: StairsStyle; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'down', label: 'Down' },
  { id: 'up', label: 'Up' },
  { id: 'both', label: 'Both' },
];

const KEYS: Array<{ id: KeyDetail; label: string }> = [
  { id: 'brief', label: 'Brief' },
  { id: 'full', label: 'Full' },
  { id: 'stocked', label: 'Stocked' },
];

const CAVERNS: Array<{ id: CavernOpenness; label: string }> = [
  { id: 'tight', label: 'Tight' },
  { id: 'natural', label: 'Natural' },
  { id: 'open', label: 'Open' },
];

const DENSITY: Array<{ id: RoomDensity; label: string }> = [
  { id: 'sparse', label: 'Sparse' },
  { id: 'normal', label: 'Normal' },
  { id: 'packed', label: 'Packed' },
];

const FURNISH: Array<{ id: FurnishingStyle; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'light', label: 'Light' },
  { id: 'full', label: 'Full' },
];

const MOTIFS: Array<{ id: DungeonMotif; label: string }> = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'crypt', label: 'Crypt' },
  { id: 'temple', label: 'Temple' },
  { id: 'fortress', label: 'Fortress' },
  { id: 'mine', label: 'Mine' },
  { id: 'ruin', label: 'Ruin' },
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

export function DungeonGeneratorPanel() {
  const [layout, setLayout] = useState<DungeonLayout>('rooms');
  const [size, setSize] = useState<DungeonSize>('medium');
  const [motif, setMotif] = useState<DungeonMotif>('mixed');
  const [doors, setDoors] = useState<DoorStyle>('mixed');
  const [secrets, setSecrets] = useState<SecretStyle>('few');
  const [corridors, setCorridors] = useState<CorridorStyle>('straight');
  const [passages, setPassages] = useState<PassageStyle>('linked');
  const [deadEnds, setDeadEnds] = useState<DeadEndStyle>('few');
  const [stairs, setStairs] = useState<StairsStyle>('down');
  const [floors, setFloors] = useState(1);
  const [keyDetail, setKeyDetail] = useState<KeyDetail>('full');
  const [cavern, setCavern] = useState<CavernOpenness>('natural');
  const [density, setDensity] = useState<RoomDensity>('normal');
  const [chambers, setChambers] = useState<ChamberScale>('normal');
  const [furnishings, setFurnishings] = useState<FurnishingStyle>('full');
  const [seedText, setSeedText] = useState('');
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const built = layout !== 'cavern';

  async function generate() {
    if (busy) return;
    setBusy(true);
    const parsed = Number(seedText.trim());
    const seed = seedText.trim() !== '' && Number.isFinite(parsed)
      ? (parsed >>> 0)
      : (Math.random() * 0xffffffff) >>> 0;
    const options = {
      layout,
      size,
      doors,
      seed,
      motif,
      corridors,
      passages,
      deadEnds,
      stairs,
      key: keyDetail,
      secrets,
      cavern,
      density,
      chambers,
      furnishings,
    };
    try {
      await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
      await placeDungeonFloors(options, floors);
      setLastSeed(seed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ToolSection id="dungeon" title="Dungeon">
      <ChoiceRow label="Layout" value={layout} options={LAYOUTS} onChange={setLayout} />
      <ChoiceRow label="Size" value={size} options={SIZES} onChange={setSize} />
      {built && layout !== 'five-room' && (
        <ChoiceRow label="Density" value={density} options={DENSITY} onChange={setDensity} />
      )}
      {built && (
        <ChoiceRow label="Chambers" value={chambers} options={CHAMBERS} onChange={setChambers} />
      )}
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Motif</span>
        <select
          className="input-dark w-full text-xs py-1"
          value={motif}
          onChange={(event) => setMotif(event.target.value as DungeonMotif)}
        >
          {MOTIFS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      {built ? (
        <>
          <ChoiceRow label="Doors" value={doors} options={DOORS} onChange={setDoors} />
          <ChoiceRow label="Secrets" value={secrets} options={SECRETS} onChange={setSecrets} />
          <ChoiceRow label="Corridors" value={corridors} options={CORRIDORS} onChange={setCorridors} />
          <ChoiceRow label="Passages" value={passages} options={PASSAGES} onChange={setPassages} />
          <ChoiceRow label="Dead ends" value={deadEnds} options={DEAD_ENDS} onChange={setDeadEnds} />
        </>
      ) : (
        <ChoiceRow label="Cavern" value={cavern} options={CAVERNS} onChange={setCavern} />
      )}
      <ChoiceRow label="Furnishings" value={furnishings} options={FURNISH} onChange={setFurnishings} />
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Floors</span>
        <input
          className="input-dark w-full text-xs py-1"
          inputMode="numeric"
          min={1}
          max={12}
          value={floors}
          onChange={(event) => {
            const next = Number(event.target.value);
            setFloors(Number.isFinite(next) ? Math.min(12, Math.max(1, Math.floor(next))) : 1);
          }}
        />
      </label>
      {floors <= 1 && (
        <ChoiceRow label="Stairs" value={stairs} options={STAIRS} onChange={setStairs} />
      )}
      <ChoiceRow label="Key" value={keyDetail} options={KEYS} onChange={setKeyDetail} />
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
        {busy ? 'Generating…' : 'Generate map'}
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
        2XL/3XL are big floors (3XL can take a few seconds). Gauntlet is a left-to-right spine. Chambers scales room size. Floors go up to 12. Mega + packed + grand is the heaviest combo.
      </p>
    </ToolSection>
  );
}
