import { useMemo, useState } from 'react';
import { D5E_CONDITION_REFERENCE } from '@grimoire/shared';
import { GOLD } from '../dmStyles';

export function ConditionsRefTab() {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return D5E_CONDITION_REFERENCE;
    return D5E_CONDITION_REFERENCE.filter(
      (c) => c.name.toLowerCase().includes(q) || c.summary.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <div className="space-y-2">
      <input
        className="input-dark w-full text-xs py-1"
        placeholder="Search conditions…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="space-y-2">
        {filtered.map((c) => (
          <div
            key={c.name}
            className="rounded p-2"
            style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}
          >
            <div className="font-display text-xs mb-0.5" style={{ color: GOLD }}>{c.name}</div>
            <p className="font-ui text-[10px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
              {c.summary}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
