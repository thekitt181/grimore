import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { fetchDdbCharacters, fetchDdbStatus } from './ddbApi';
import { proxiedDdbImageUrl } from './ddbImageUrl';
import { importCharacterToMap } from './importCharacter';
import { useDdbStore } from './ddbStore';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionStore } from '@/store/sessionStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

export function CharacterImportModal({
  onClose,
  linkTokenId,
  onImported,
}: {
  onClose: () => void;
  linkTokenId?: string;
  onImported?: (token: TokenItem) => void;
}) {
  const [importing, setImporting] = useState<number | null>(null);
  const [manualId, setManualId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const setLinkPanelOpen = useDdbStore((s) => s.setLinkPanelOpen);
  const myRole = useSessionStore((s) => s.myRole);
  const isPlayer = myRole !== 'GM';

  const { data: status } = useQuery({
    queryKey: ['ddb', 'status'],
    queryFn: fetchDdbStatus,
  });

  const { data: characters, isLoading, isError, error: listError } = useQuery({
    queryKey: ['ddb', 'characters'],
    queryFn: fetchDdbCharacters,
    retry: false,
  });

  async function handleImport(ddbCharacterId: number) {
    setImporting(ddbCharacterId);
    setError(null);
    try {
      const token = await importCharacterToMap(ddbCharacterId, undefined, linkTokenId);
      if (token) onImported?.(token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(null);
    }
  }

  const title = linkTokenId
    ? 'Link D&D Beyond character'
    : isPlayer
      ? 'Load my D&D Beyond token'
      : 'Import character to map';

  return (
    <DraggablePanel
      title={title}
      subtitle="D&D Beyond"
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 480) / 2), y: 72 }}
      width={480}
      maxHeight="80vh"
      zIndex={150}
    >
      <div className="p-4 space-y-4">
        <div
          className="rounded px-3 py-2 space-y-2"
          style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
        >
          <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            {isPlayer
              ? 'Link your D&D Beyond account to pick from your characters, or paste the ID from your sheet URL (dndbeyond.com/characters/'
              : 'Import by character ID from the sheet URL bar (dndbeyond.com/characters/'}
            <strong>12345678</strong>).
          </p>
          {isPlayer && (
            <button
              type="button"
              className="btn-ghost text-xs w-full"
              onClick={() => setLinkPanelOpen(true)}
            >
              {status?.linked ? 'D&D Beyond account' : 'Link my D&D Beyond account'}
            </button>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              inputMode="numeric"
              className="flex-1 rounded px-2 py-1 font-mono text-xs"
              style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              placeholder="Character ID"
              value={manualId}
              onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))}
            />
            <button
              type="button"
              className="btn-primary text-xs shrink-0"
              disabled={!manualId || importing !== null}
              onClick={() => void handleImport(parseInt(manualId, 10))}
            >
              {isPlayer ? 'Load' : 'Import'}
            </button>
          </div>
        </div>

        {status?.linked && !status.valid ? (
          <p className="font-ui text-sm" style={{ color: 'var(--color-accent-red-hot)' }}>
            Session expired — re-link your Cobalt token.
          </p>
        ) : isLoading ? (
          <p className="font-ui text-sm">Loading characters…</p>
        ) : isError ? (
          <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {listError instanceof Error ? listError.message : 'Could not load character list. Use the ID field above.'}
          </p>
        ) : !characters?.length ? (
          <div className="font-ui text-sm space-y-2" style={{ color: 'var(--color-text-secondary)' }}>
            <p>No characters were returned from D&D Beyond.</p>
            <p className="text-[11px]">
              Use the ID field above if your sheet exists but is not in a campaign.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {characters.map((ch) => (
              <div
                key={ch.ddbCharacterId}
                className="flex items-center gap-3 rounded px-3 py-2"
                style={{ background: 'var(--color-bg-tertiary)', border: `1px solid ${BD}` }}
              >
                {ch.avatarUrl ? (
                  <img src={proxiedDdbImageUrl(ch.avatarUrl)} alt="" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
                    style={{ background: 'var(--color-bg-primary)' }}
                  >
                    🧙
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="font-display text-xs truncate" style={{ color: GOLD }}>{ch.name}</div>
                  <div className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
                    Lvl {ch.level} {ch.classLabel}
                    {ch.campaignName ? ` · ${ch.campaignName}` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-primary text-xs shrink-0"
                  disabled={importing === ch.ddbCharacterId}
                  onClick={() => void handleImport(ch.ddbCharacterId)}
                >
                  {importing === ch.ddbCharacterId ? '…' : linkTokenId ? 'Link' : isPlayer ? 'Load' : 'Import'}
                </button>
              </div>
            ))}
          </div>
        )}
        {error && (
          <div
            className="font-ui text-xs rounded px-3 py-2 space-y-1"
            style={{ color: 'var(--color-accent-red-hot)', background: 'rgba(127,29,29,0.15)', border: '1px solid rgba(248,113,113,0.3)' }}
          >
            <p className="font-display text-[11px]">Import failed</p>
            <p>{error}</p>
          </div>
        )}
      </div>
    </DraggablePanel>
  );
}
