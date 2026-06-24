import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useQueryClient } from '@tanstack/react-query';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { TokenItem } from '@/systems/scene/types';
import { PartyCharacterCard } from '../components/PartyCharacterCard';
import { syncDdbCharacter } from '@/systems/ddb/ddbApi';
import { pullDdbHpToToken } from '@/systems/ddb/useDdbHpSync';

export function PartyDdbTab() {
  const qc = useQueryClient();
  const [syncingAll, setSyncingAll] = useState(false);
  const pcTokens = useItemStore(
    useShallow((s) =>
      Object.values(s.items).filter(
        (i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId),
      ),
    ),
  );

  async function handleSyncAll() {
    if (syncingAll) return;
    setSyncingAll(true);
    try {
      const results = await Promise.allSettled(
        pcTokens.map(async (token) => {
          const ch = await syncDdbCharacter(token.ddbCharacterId!);
          qc.setQueryData(['ddb', 'character', token.ddbCharacterId!], ch);
          pullDdbHpToToken(token.id, ch);
        })
      );
      const successCount = results.filter(r => r.status === 'fulfilled').length;
      console.log(`Synced ${successCount}/${pcTokens.length} characters`);
    } catch (err) {
      console.error('Sync all failed:', err);
    } finally {
      setSyncingAll(false);
    }
  }

  if (pcTokens.length === 0) {
    return (
      <p className="font-ui text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
        No D&amp;D Beyond PCs on the map yet. Import a character from the sidebar → <strong>Import PC</strong>, then link the token.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
          Sync pulls spell slots, inventory, and death saves from D&amp;D Beyond. HP/death saves push when <strong>Push HP</strong> is enabled on the token.
        </p>
        <button
          type="button"
          className="btn-primary text-[10px] px-2 py-1"
          disabled={syncingAll}
          onClick={() => void handleSyncAll()}
        >
          {syncingAll ? 'Syncing…' : 'Sync All'}
        </button>
      </div>
      {pcTokens.map((token) => (
        <PartyCharacterCard key={token.id} token={token} />
      ))}
    </div>
  );
}
