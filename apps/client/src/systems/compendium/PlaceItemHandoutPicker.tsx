import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { CompendiumItem } from '@grimoire/shared';
import { searchItems } from './compendiumApi';
import { placeItemHandout } from './placeItemHandout';

export function PlaceItemHandoutPicker({
  worldX,
  worldY,
  onPlace,
  onBack,
}: {
  worldX: number;
  worldY: number;
  onPlace?: () => void;
  onBack?: () => void;
}) {
  const [query, setQuery] = useState('');

  const itemsQ = useQuery({
    queryKey: ['compendium', 'handout-picker', query],
    queryFn: () => searchItems({ q: query, limit: 25 }),
  });

  function pick(item: CompendiumItem) {
    void placeItemHandout(item, { x: worldX, y: worldY });
    onPlace?.();
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
          placeholder="Search items…"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="max-h-48 overflow-y-auto px-1 space-y-0.5">
        {itemsQ.isLoading && (
          <p className="font-ui text-xs px-2 py-1" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
        )}
        {itemsQ.isError && (
          <p className="font-ui text-xs px-2 py-1" style={{ color: 'var(--color-accent-red-hot)' }}>
            Could not load items.
          </p>
        )}
        {itemsQ.data?.items.map((item) => (
          <button
            key={item.id}
            type="button"
            className="w-full text-left px-2 py-1 rounded text-xs font-ui hover:opacity-90"
            style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
            onClick={() => pick(item)}
          >
            <span className="block truncate">{item.name}</span>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>{item.type}</span>
          </button>
        ))}
        {!itemsQ.isLoading && !itemsQ.isError && itemsQ.data?.items.length === 0 && (
          <p className="font-ui text-xs px-2 py-1" style={{ color: 'var(--color-text-secondary)' }}>No matches</p>
        )}
      </div>
    </div>
  );
}
