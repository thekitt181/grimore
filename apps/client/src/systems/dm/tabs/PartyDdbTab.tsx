import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQueryClient } from '@tanstack/react-query';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { PartyCharacterCard } from '../components/PartyCharacterCard';
import { syncDdbCharacter } from '@/systems/ddb/ddbApi';
import { pullDdbHpToToken } from '@/systems/ddb/useDdbHpSync';
import { useDdbStore } from '@/systems/ddb/ddbStore';

export function PartyDdbTab() {
  const qc = useQueryClient();
  const [syncingAll, setSyncingAll] = useState(false);
  const [nameQuery, setNameQuery] = useState('');
  const pcTokens = useItemStore(
    useShallow((s) =>
      Object.values(s.items).filter(
        (i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId),
      ),
    ),
  );
  const needle = nameQuery.trim().toLowerCase();
  const shown = needle
    ? pcTokens.filter((t) => t.name.toLowerCase().includes(needle))
    : pcTokens;

  async function handleSyncAll() {
    if (syncingAll) return;
    setSyncingAll(true);
    try {
      await Promise.allSettled(
        pcTokens.map(async (token) => {
          const ch = await syncDdbCharacter(token.ddbCharacterId!);
          qc.setQueryData(['ddb', 'character', token.ddbCharacterId!], ch);
          pullDdbHpToToken(token.id, ch);
        }),
      );
    } catch {
      /* cards show their own errors */
    } finally {
      setSyncingAll(false);
    }
  }

  if (pcTokens.length === 0) {
    return (
      <div className="space-y-2">
        <p className="font-ui text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          No D&amp;D Beyond characters on the map yet.
        </p>
        <button
          type="button"
          className="btn-primary text-xs"
          onClick={() => useDdbStore.getState().setImportModalOpen(true)}
        >
          Open characters
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center gap-2">
        <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          Sync pulls spell slots and inventory. HP pushes when <strong>Push HP</strong> is on.
        </p>
        <button
          type="button"
          className="btn-primary text-[10px] px-2 py-1 shrink-0"
          disabled={syncingAll}
          onClick={() => void handleSyncAll()}
        >
          {syncingAll ? 'Syncing…' : 'Sync All'}
        </button>
      </div>
      {pcTokens.length > 4 && (
        <input
          type="search"
          className="w-full rounded px-2 py-1 font-ui text-[11px]"
          style={{ background: 'var(--color-bg-primary)', border: '1px solid var(--color-border)' }}
          placeholder="Search party by name…"
          value={nameQuery}
          onChange={(e) => setNameQuery(e.target.value)}
        />
      )}
      {shown.map((token) => (
        <PartyCharacterCard key={token.id} token={token} />
      ))}
      {shown.length === 0 && (
        <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          No party members match that name.
        </p>
      )}
    </div>
  );
}
