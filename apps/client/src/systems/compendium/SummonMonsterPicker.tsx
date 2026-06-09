import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompendiumMonster } from '@grimoire/shared';
import { searchMonsters } from './compendiumApi';
import { summonMonster } from './summonMonster';

export function SummonMonsterPicker({
  worldX,
  worldY,
  onSummon,
  onBack,
}: {
  worldX: number;
  worldY: number;
  onSummon?: () => void;
  onBack?: () => void;
}) {
  const [query, setQuery] = useState('');

  const monstersQ = useQuery({
    queryKey: ['compendium', 'summon-picker', query],
    queryFn: () => searchMonsters({ q: query, limit: 25 }),
  });

  function pick(monster: CompendiumMonster) {
    summonMonster(monster, { x: worldX, y: worldY });
    onSummon?.();
  }

  return (
    <div className="py-1">
      {onBack && (
        <button
          type="button"
          className="w-full text-left px-3 py-1 text-xs font-ui opacity-70 hover:opacity-100"
          style={{ color: 'var(--color-accent-gold)' }}
          onClick={onBack}
        >
          ← Back
        </button>
      )}
      <div className="px-2 py-1">
        <input
          className="input-dark text-xs py-0.5 w-full"
          placeholder="Search monsters…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-48 overflow-y-auto px-1 space-y-0.5">
        {monstersQ.isLoading && (
          <p className="font-ui text-xs px-2 py-1" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
        )}
        {monstersQ.isError && (
          <p className="font-ui text-xs px-2 py-1" style={{ color: 'var(--color-accent-red-hot)' }}>
            Could not load monsters.
          </p>
        )}
        {monstersQ.data?.items.map((m) => (
          <button
            key={m.id}
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs font-ui hover:opacity-90"
            style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
            onClick={() => pick(m)}
          >
            <span className="block truncate">{m.name}</span>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>CR {m.cr}</span>
          </button>
        ))}
        {!monstersQ.isLoading && !monstersQ.isError && monstersQ.data?.items.length === 0 && (
          <p className="font-ui text-xs px-2 py-1" style={{ color: 'var(--color-text-secondary)' }}>No matches</p>
        )}
      </div>
    </div>
  );
}
