import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { TokenItem } from '@/systems/scene/types';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  SPELL_EFFECTS_CATALOG,
  type SpellEffectCatalogEntry,
} from './spellEffectsCatalog';
import { castModeLabel } from './spellCastPlacement';
import { SpellEffectCastControls } from './SpellEffectCastControls';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function CatalogSpellCastRow({
  entry,
  token,
}: {
  entry: SpellEffectCatalogEntry;
  token: TokenItem;
}) {
  return (
    <div
      className="rounded px-2 py-1.5 space-y-1"
      style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-primary)' }}>
          {entry.name}
        </p>
        <span
          className="font-ui text-[8px] uppercase tracking-wide px-1 py-0.5 rounded shrink-0"
          style={{ border: `1px solid ${GOLD}`, color: GOLD }}
        >
          {castModeLabel(entry.castMode)}
        </span>
      </div>

      <SpellEffectCastControls
        casterToken={token}
        spellName={entry.name}
        catalog={entry}
        concentration={entry.concentration}
        compact
        {...(entry.aoe ? { aoe: entry.aoe } : {})}
      />
    </div>
  );
}

export function SpellsWithEffectsPanel() {
  const tokens = useItemStore(useShallow((s) =>
    Object.values(s.items).filter((i): i is TokenItem => i.type === 'token'),
  ));
  const myUserId = useSessionStore((s) => s.myUserId);
  const [casterId, setCasterId] = useState('');
  const [filter, setFilter] = useState('');

  const defaultCasterId = useMemo(() => {
    if (!tokens.length) return '';
    if (myUserId) {
      const owned = tokens.find((t) => t.ownerId === myUserId);
      if (owned) return owned.id;
    }
    return tokens[0]!.id;
  }, [tokens, myUserId]);

  const effectiveCasterId = casterId || defaultCasterId;
  const caster = tokens.find((t) => t.id === effectiveCasterId) ?? tokens[0];
  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return SPELL_EFFECTS_CATALOG;
    return SPELL_EFFECTS_CATALOG.filter(
      (e) => e.name.toLowerCase().includes(q) || e.castMode.includes(q),
    );
  }, [filter]);

  const byMode = useMemo(() => {
    const groups: Record<string, SpellEffectCatalogEntry[]> = {
      aoe: [], ranged: [], melee: [], self: [],
    };
    for (const e of filtered) groups[e.castMode]?.push(e);
    return groups;
  }, [filtered]);

  if (tokens.length === 0) {
    return (
      <p className="font-ui text-[10px] px-1" style={{ color: 'var(--color-text-secondary)' }}>
        Place a token on the map to cast spell effects.
      </p>
    );
  }

  return (
    <div className="space-y-2 max-h-[min(50vh,420px)] overflow-y-auto pr-0.5">
      <p className="font-ui text-[9px] uppercase tracking-wide" style={{ color: GOLD }}>
        Spell VFX · {SPELL_EFFECTS_CATALOG.length} spells
      </p>

      <select
        value={effectiveCasterId}
        onChange={(e) => setCasterId(e.target.value)}
        className="font-ui text-[10px] w-full rounded px-2 py-1"
        style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}`, color: 'var(--color-text-primary)' }}
      >
        {tokens.map((t) => (
          <option key={t.id} value={t.id}>Caster: {t.name}</option>
        ))}
      </select>

      <input
        type="search"
        placeholder="Filter spells…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="font-ui text-[10px] w-full rounded px-2 py-1"
        style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}`, color: 'var(--color-text-primary)' }}
      />

      {caster && (
        <>
          {(['aoe', 'ranged', 'melee', 'self'] as const).map((mode) => {
            const items = byMode[mode];
            if (!items?.length) return null;
            return (
              <div key={mode} className="space-y-1">
                <p className="font-ui text-[9px] uppercase tracking-wide px-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                  {castModeLabel(mode)} ({items.length})
                </p>
                {items.map((entry) => (
                  <CatalogSpellCastRow
                    key={entry.id}
                    entry={entry}
                    token={caster}
                  />
                ))}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
