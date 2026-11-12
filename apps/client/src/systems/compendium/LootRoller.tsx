import { useState } from 'react';
import { formatItemMarketLine, resolveItemMarketPrice } from '@grimoire/shared';
import type { LootDrop } from './compendiumApi';
import { rollLoot } from './compendiumApi';
import { placeLootDrops } from './placeLoot';
import { useMapStore } from '@/systems/map/store/mapStore';

export const LOOT_SOURCES: Array<{ id: string; label: string }> = [
  { id: 'this', label: 'This' },
  { id: 'skeleton', label: 'Skeleton' },
  { id: 'zombie', label: 'Zombie' },
  { id: 'goblin', label: 'Goblin' },
  { id: 'bandit', label: 'Bandit' },
  { id: 'orc', label: 'Orc' },
  { id: 'cultist', label: 'Cultist' },
  { id: 'chest', label: 'Chest' },
  { id: 'dragon', label: 'Dragon' },
  { id: 'dragon-hoard', label: 'Dragon hoard' },
  { id: 'delerium', label: 'Delerium' },
  { id: 'ruby', label: 'Ruby' },
  { id: 'emerald', label: 'Emerald' },
  { id: 'topaz', label: 'Topaz' },
  { id: 'sapphire', label: 'Sapphire' },
  { id: 'diamond', label: 'Diamond' },
  { id: 'gold', label: 'Gold' },
  { id: 'fire', label: 'Fire' },
  { id: 'ice', label: 'Ice' },
  { id: 'lightning', label: 'Lightning' },
  { id: 'beast', label: 'Beast' },
  { id: 'mimic', label: 'Mimic' },
  { id: 'corpse', label: 'Corpse' },
  { id: 'any', label: 'Anything' },
];

/** Always use the creature's own name. Extra dropdown tables are optional overrides. */
export function guessLootSource(name: string): string {
  return name.trim() ? 'this' : 'any';
}

function dropTitle(drop: LootDrop): string {
  return drop.kind === 'currency' ? drop.label : drop.name;
}

function dropNote(drop: LootDrop): string {
  if (drop.kind === 'item') {
    const price = resolveItemMarketPrice({
      name: drop.name,
      type: drop.type,
      ...(drop.rarity ? { rarity: drop.rarity } : {}),
    });
    return [
      drop.rarity,
      drop.type,
      drop.reflavoredFrom ? `was ${drop.reflavoredFrom}` : null,
      price ? formatItemMarketLine(price) : null,
    ].filter(Boolean).join(' · ') || 'Codex item';
  }
  if (drop.kind === 'flavor') return 'Flavor';
  return 'Coins';
}

interface HeldDrop {
  key: string;
  drop: LootDrop;
}

let heldKey = 0;
function nextKey(): string {
  heldKey += 1;
  return `loot-${heldKey}`;
}

export function LootRoller({
  targetId,
  targetName = '',
  onDone,
}: {
  targetId?: string;
  targetName?: string;
  onDone?: () => void;
}) {
  const [source, setSource] = useState(() => guessLootSource(targetName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [current, setCurrent] = useState<HeldDrop[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [kept, setKept] = useState<HeldDrop[]>([]);
  const lootLevel = useMapStore((s) => s.lootLevel);
  const lootMin = useMapStore((s) => s.lootMin);
  const lootMax = useMapStore((s) => s.lootMax);

  const low = Math.min(lootMin, lootMax);
  const high = Math.max(lootMin, lootMax);
  const checked = current.filter((row) => picked[row.key]);
  const ready = kept.length + checked.length;

  function toggle(key: string) {
    setPicked((rows) => ({ ...rows, [key]: !rows[key] }));
  }

  async function roll(keepChecked: boolean) {
    if (busy) return;
    const moving = keepChecked ? checked : [];
    setBusy(true);
    setError(null);
    try {
      const level = lootLevel ?? undefined;
      const next = await rollLoot({
        min: low,
        max: high,
        source,
        ...(targetName ? { name: targetName } : {}),
        ...(level != null ? { level } : {}),
      });
      setKept((rows) => [...rows, ...moving]);
      setCurrent(next.drops.map((drop) => ({ key: nextKey(), drop })));
      setPicked({});
      setSummary(`${next.count} from ${next.source} · ${next.partyLevel == null ? 'any level' : `level ${next.partyLevel}`}`);
    } catch {
      setError('Could not roll loot. The item codex may still be loading.');
    } finally {
      setBusy(false);
    }
  }

  async function summon(closeAfter: boolean) {
    const drops = [...kept.map((row) => row.drop), ...checked.map((row) => row.drop)];
    if (drops.length === 0) {
      if (closeAfter) onDone?.();
      else setError('Tick the drops you want, then summon them.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const placed = await placeLootDrops(drops, targetId);
      if (!placed) {
        setError(targetId ? 'That thing is no longer on the map.' : 'Select a map first.');
        return;
      }
      const taken = new Set([...kept.map((row) => row.key), ...checked.map((row) => row.key)]);
      setKept([]);
      setCurrent((rows) => rows.filter((row) => !taken.has(row.key)));
      setPicked({});
      if (closeAfter) onDone?.();
    } catch {
      setError('Could not place that loot.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          Where it comes from
        </span>
        <select
          className="input-dark w-full text-xs py-1"
          value={source}
          onChange={(event) => setSource(event.target.value)}
        >
          {LOOT_SOURCES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.id === 'this' && targetName ? `This (${targetName})` : option.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="btn-primary w-full text-xs py-1.5"
        disabled={busy}
        onClick={() => { void roll(current.length > 0); }}
      >
        {busy ? 'Rolling…' : current.length > 0 ? 'Reroll' : `Roll ${low}–${high}`}
      </button>
      {summary && (
        <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{summary}</p>
      )}
      {error && (
        <p className="font-ui text-xs" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
      )}
      {kept.length > 0 && (
        <div className="space-y-1">
          <p className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Kept</p>
          {kept.map((row) => (
            <div key={row.key} className="flex items-start gap-1.5">
              <span className="font-ui text-xs flex-1 min-w-0" style={{ color: 'var(--color-text-primary)' }}>{dropTitle(row.drop)}</span>
              <button
                type="button"
                className="text-xs opacity-40 hover:opacity-100"
                style={{ color: 'var(--color-accent-red-hot)' }}
                title="Drop this"
                onClick={() => setKept((rows) => rows.filter((entry) => entry.key !== row.key))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
      {current.length > 0 && (
        <div className="space-y-1">
          {current.map((row) => (
            <label key={row.key} className="flex items-start gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={Boolean(picked[row.key])}
                onChange={() => toggle(row.key)}
              />
              <span className="min-w-0">
                <span className="font-ui text-xs block leading-snug" style={{ color: 'var(--color-text-primary)' }}>{dropTitle(row.drop)}</span>
                <span className="font-ui text-[10px] block" style={{ color: 'var(--color-text-secondary)' }}>{dropNote(row.drop)}</span>
              </span>
            </label>
          ))}
        </div>
      )}
      <div className="flex gap-1">
        <button type="button" className="btn-primary flex-1 text-xs py-1" disabled={busy || ready === 0} onClick={() => { void summon(false); }}>
          Summon{ready > 0 ? ` ${ready}` : ''}
        </button>
        <button type="button" className="btn-ghost flex-1 text-xs py-1" disabled={busy} onClick={() => { void summon(true); }}>
          Done
        </button>
      </div>
      <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
        Loot follows the monster's name, not a fixed list — every word (beholder, umber hulk, ruby dragon, delerium) pulls matching treasure. Tick what you want, reroll the rest, then summon it around {targetName || 'the map'}. Blank level uses any rarity. Loot stays hidden until you reveal it.
      </p>
    </div>
  );
}
