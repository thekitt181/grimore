import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { fetchDdbCharacters, fetchDdbStatus } from './ddbApi';
import { proxiedDdbImageUrl } from './ddbImageUrl';
import { importCharacterToMap } from './importCharacter';
import { useDdbStore } from './ddbStore';
import type { TokenItem } from '@/systems/scene/types';
import { useSessionStore } from '@/store/sessionStore';
import { useItemStore } from '@/systems/scene/store/itemStore';
import type { DdbCharacterSummary } from '@grimoire/shared';

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
  const [nameQuery, setNameQuery] = useState('');
  const [showId, setShowId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setLinkPanelOpen = useDdbStore((s) => s.setLinkPanelOpen);
  const myRole = useSessionStore((s) => s.myRole);
  const isPlayer = myRole !== 'GM';
  const hasMap = useItemStore((s) => Object.values(s.items).some((i) => i.type === 'map'));
  const tokensOnTable = useItemStore((s) =>
    Object.values(s.items).filter((i): i is TokenItem => i.type === 'token' && Boolean(i.ddbCharacterId)),
  );
  const onTableByDdb = useMemo(() => {
    const map = new Map<number, TokenItem>();
    for (const t of tokensOnTable) {
      if (t.ddbCharacterId != null) map.set(t.ddbCharacterId, t);
    }
    return map;
  }, [tokensOnTable]);

  const { data: status } = useQuery({
    queryKey: ['ddb', 'status'],
    queryFn: fetchDdbStatus,
  });

  const { data: characters, isLoading, isError, error: listError, refetch } = useQuery({
    queryKey: ['ddb', 'characters'],
    queryFn: fetchDdbCharacters,
    retry: false,
  });

  async function handleImport(ddbCharacterId: number) {
    setImporting(ddbCharacterId);
    setError(null);
    try {
      const token = await importCharacterToMap(ddbCharacterId, undefined, linkTokenId);
      if (!token) {
        setError('No map on the table yet — wait for the GM to place one, then try again.');
        return;
      }
      onImported?.(token);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load that character.');
    } finally {
      setImporting(null);
    }
  }

  const nameNeedle = nameQuery.trim().toLowerCase();
  const filteredCharacters = useMemo(() => {
    const list = [...(characters ?? [])];
    list.sort((a, b) => {
      const aOwned = a.isOwned ? 0 : 1;
      const bOwned = b.isOwned ? 0 : 1;
      if (aOwned !== bOwned) return aOwned - bOwned;
      return a.name.localeCompare(b.name);
    });
    if (!nameNeedle) return list;
    return list.filter((ch) => {
      const hay = `${ch.name} ${ch.classLabel ?? ''} ${ch.campaignName ?? ''}`.toLowerCase();
      return hay.includes(nameNeedle);
    });
  }, [characters, nameNeedle]);

  const title = linkTokenId
    ? 'Link D&D Beyond character'
    : isPlayer
      ? 'My character'
      : 'Characters';

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
      <div className="p-4 space-y-3">
        <p className="font-ui text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
          {linkTokenId
            ? 'Pick the D&D Beyond sheet for this token.'
            : isPlayer
              ? 'Search your name and load your token onto the map. Link D&D Beyond if the list is empty.'
              : 'Search a name, then import. Players can also load their own from My character.'}
        </p>

        {!hasMap && (
          <div
            className="font-ui text-xs rounded px-3 py-2"
            style={{ color: 'var(--color-accent-gold)', background: 'rgba(201,168,76,0.1)', border: '1px solid rgba(201,168,76,0.35)' }}
          >
            No map on the table yet — wait for the GM to place one, then load your token.
          </div>
        )}
        {error && (
          <div
            className="font-ui text-xs rounded px-3 py-2"
            style={{ color: 'var(--color-accent-red-hot)', background: 'rgba(127,29,29,0.15)', border: '1px solid rgba(248,113,113,0.3)' }}
          >
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="btn-ghost text-xs py-1 px-2"
            onClick={() => setLinkPanelOpen(true)}
          >
            {status?.linked ? 'Account' : 'Link D&D Beyond'}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs py-1 px-2"
            onClick={() => void refetch()}
            disabled={isLoading}
          >
            Refresh list
          </button>
        </div>

        {status?.linked && !status.valid ? (
          <p className="font-ui text-sm" style={{ color: 'var(--color-accent-red-hot)' }}>
            D&D Beyond session expired — re-link your account.
          </p>
        ) : isLoading ? (
          <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>Loading characters…</p>
        ) : isError ? (
          <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {listError instanceof Error ? listError.message : 'Could not load the character list.'}
          </p>
        ) : !characters?.length ? (
          <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            No characters yet. Link D&D Beyond, or paste a character ID below.
          </p>
        ) : (
          <div className="space-y-2">
            <input
              type="search"
              className="w-full rounded px-2 py-1.5 font-ui text-xs"
              style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              placeholder="Search by name…"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              autoFocus
            />
            {filteredCharacters.length === 0 ? (
              <p className="font-ui text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                No characters match “{nameQuery.trim()}”.
              </p>
            ) : (
              filteredCharacters.map((ch) => (
                <CharacterRow
                  key={ch.ddbCharacterId}
                  ch={ch}
                  onTable={onTableByDdb.get(ch.ddbCharacterId)}
                  importing={importing === ch.ddbCharacterId}
                  busy={importing !== null || !hasMap}
                  actionLabel={linkTokenId ? 'Link' : onTableByDdb.has(ch.ddbCharacterId) ? 'Update' : isPlayer ? 'Load' : 'Import'}
                  onPick={() => void handleImport(ch.ddbCharacterId)}
                />
              ))
            )}
          </div>
        )}

        <div>
          <button
            type="button"
            className="font-ui text-[11px] underline-offset-2 hover:underline"
            style={{ color: 'var(--color-text-secondary)' }}
            onClick={() => setShowId((v) => !v)}
          >
            {showId ? 'Hide character ID' : 'Paste character ID instead'}
          </button>
          {showId && (
            <div className="flex gap-2 mt-2">
              <input
                type="text"
                inputMode="numeric"
                className="flex-1 rounded px-2 py-1 font-mono text-xs"
                style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
                placeholder="From dndbeyond.com/characters/…"
                value={manualId}
                onChange={(e) => setManualId(e.target.value.replace(/\D/g, ''))}
              />
              <button
                type="button"
                className="btn-primary text-xs shrink-0"
                disabled={!manualId || importing !== null || !hasMap}
                onClick={() => void handleImport(parseInt(manualId, 10))}
              >
                {isPlayer ? 'Load' : 'Import'}
              </button>
            </div>
          )}
        </div>

      </div>
    </DraggablePanel>
  );
}

function CharacterRow({
  ch,
  onTable,
  importing,
  busy,
  actionLabel,
  onPick,
}: {
  ch: DdbCharacterSummary;
  onTable?: TokenItem | undefined;
  importing: boolean;
  busy: boolean;
  actionLabel: string;
  onPick: () => void;
}) {
  return (
    <div
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
          {onTable ? ' · on the map' : ''}
        </div>
      </div>
      <button
        type="button"
        className="btn-primary text-xs shrink-0"
        disabled={busy}
        onClick={onPick}
      >
        {importing ? '…' : actionLabel}
      </button>
    </div>
  );
}
