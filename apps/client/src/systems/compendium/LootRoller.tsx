import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { LootDrop } from './compendiumApi';
import { rollLoot } from './compendiumApi';
import { placeLootDrops } from './placeLoot';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';

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
  { id: 'beast', label: 'Beast' },
  { id: 'mimic', label: 'Mimic' },
  { id: 'corpse', label: 'Corpse' },
  { id: 'any', label: 'Anything' },
];

const SOURCE_GUESSES: Array<[RegExp, string]> = [
  [/hoard/, 'dragon-hoard'],
  [/dragon|wyrm|drake/, 'dragon'],
  [/skeleton|skeletal/, 'skeleton'],
  [/zombie|ghoul|wight/, 'zombie'],
  [/ghost|spectre|specter|wraith|banshee/, 'corpse'],
  [/goblin|kobold/, 'goblin'],
  [/bandit|thug|brigand|highwayman|robber|pirate/, 'bandit'],
  [/\borc\b|hobgoblin/, 'orc'],
  [/cult|acolyte|priest/, 'cultist'],
  [/chest|coffer|trunk|crate|strongbox/, 'chest'],
  [/mimic/, 'mimic'],
  [/wolf|bear|beast|spider|rat|boar|owlbear/, 'beast'],
  [/corpse|body|remains|cadaver/, 'corpse'],
];

export function guessLootSource(name: string): string {
  const text = name.toLowerCase();
  for (const [pattern, id] of SOURCE_GUESSES) {
    if (pattern.test(text)) return id;
  }
  return name.trim() ? 'this' : 'any';
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.floor(value)));
}

function partyLevel(qc: ReturnType<typeof useQueryClient>): number | null {
  const tokens = Object.values(useItemStore.getState().items).filter(
    (item): item is TokenItem => item.type === 'token' && Boolean(item.ddbCharacterId),
  );
  const levels = tokens.flatMap((token) => {
    const character = qc.getQueryData<{ level?: number }>(['ddb', 'character', token.ddbCharacterId]);
    return character && typeof character.level === 'number' && character.level > 0 ? [character.level] : [];
  });
  if (levels.length === 0) return null;
  const average = levels.reduce((sum, level) => sum + level, 0) / levels.length;
  return clampLevel(Math.round(average));
}

function dropTitle(drop: LootDrop): string {
  return drop.kind === 'currency' ? drop.label : drop.name;
}

function dropNote(drop: LootDrop): string {
  if (drop.kind === 'item') return [drop.rarity, drop.type].filter(Boolean).join(' · ') || 'Codex item';
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
  const qc = useQueryClient();
  const [levelText, setLevelText] = useState('');
  const [minCount, setMinCount] = useState(1);
  const [maxCount, setMaxCount] = useState(6);
  const [source, setSource] = useState(() => guessLootSource(targetName));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [current, setCurrent] = useState<HeldDrop[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [kept, setKept] = useState<HeldDrop[]>([]);
  const suggested = partyLevel(qc);

  const low = Math.min(minCount, maxCount);
  const high = Math.max(minCount, maxCount);
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
      const trimmed = levelText.trim();
      const level = trimmed === '' ? undefined : clampLevel(Number(trimmed));
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
      <label className="block space-y-1">
        <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>
          Party level
        </span>
        <input
          className="input-dark w-full text-xs py-1"
          inputMode="numeric"
          placeholder="Blank for any level"
          value={levelText}
          onChange={(event) => setLevelText(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
        />
      </label>
      {suggested != null && levelText !== String(suggested) && (
        <button
          type="button"
          className="font-ui text-xs text-left"
          style={{ color: 'var(--color-accent-gold)' }}
          onClick={() => setLevelText(String(suggested))}
        >
          Use party average ({suggested})
        </button>
      )}
      <div className="flex gap-2">
        <label className="flex-1 space-y-1">
          <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Min</span>
          <input
            className="input-dark w-full text-xs py-1"
            type="number"
            min={1}
            max={20}
            value={minCount}
            onChange={(event) => setMinCount(clampCount(Number(event.target.value)))}
          />
        </label>
        <label className="flex-1 space-y-1">
          <span className="font-ui text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>Max</span>
          <input
            className="input-dark w-full text-xs py-1"
            type="number"
            min={1}
            max={20}
            value={maxCount}
            onChange={(event) => setMaxCount(clampCount(Number(event.target.value)))}
          />
        </label>
      </div>
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
        Drops stay tied to that source: a skeleton gives bones and burial scraps, a hoard gives coins and treasure, a goblin gives junk it was carrying. Tick what you want, reroll the rest, then summon it around {targetName || 'the map'}. Blank level uses any rarity. Loot stays hidden until you reveal it.
      </p>
    </div>
  );
}
