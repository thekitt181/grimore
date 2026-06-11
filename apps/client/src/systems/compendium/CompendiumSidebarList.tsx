import { useMemo, useState, useEffect, type CSSProperties } from 'react';
import axios from 'axios';
import { useAuth } from '@clerk/clerk-react';
import { useInfiniteQuery, useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type { CompendiumItem, CompendiumMonster, CompendiumSource, CompendiumSpell } from '@grimoire/shared';
import { isHomebrewEntry } from '@grimoire/shared';
import { deleteItem, deleteMonster, deleteSpell, fetchBookSources, fetchSources, lockCompendiumSource, searchItems, searchMonsters, searchSpells, unlockCompendiumSource } from './compendiumApi';
import {
  applyCompendiumLockPolicy,
  patchCompendiumSourceLock,
  refetchCompendiumAfterLock,
} from './compendiumLockCache';
import { reloadCompendiumCatalog } from './useCompendiumAuthRecovery';
import { isApiAuthError } from '@/lib/axios';
import { isApiAuthBlocked } from '@/lib/apiAuthState';
import { prefetchCompendiumEntry } from './prefetchCompendiumEntry';
import { useCompendiumUiStore, type CompendiumBrowseMode, type CompendiumTab } from './compendiumStore';
import { useSessionStore } from '@/store/sessionStore';
import { useCompendiumEditor } from './useCompendiumEditor';
import { CompendiumAdminUnlock } from './CompendiumAdminUnlock';

const PAGE_SIZE = 50;
const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function browseBtnStyle(active: boolean): CSSProperties {
  return {
    background: active ? 'rgba(201,168,76,0.2)' : 'transparent',
    color: active ? GOLD : 'var(--color-text-secondary)',
    border: `1px solid ${active ? GOLD : BD}`,
  };
}

function compendiumErrorHint(error: unknown): string {
  if (axios.isAxiosError(error)) {
    if (!error.response) {
      return 'Cannot reach the API server. Start it with pnpm dev in grimoire-vtt (port 3001).';
    }
    if (error.response.status === 401) {
      if (isApiAuthBlocked()) {
        return 'API rejected your sign-in token. Use Retry sign-in at the top, or sign out and back in. If this persists, check Render CLERK_SECRET_KEY matches VITE_CLERK_PUBLISHABLE_KEY.';
      }
      return 'Sign in required to load the compendium.';
    }
    if (error.response.status === 403) return 'Admin password required to edit. Unlock admin mode or sign in.';
    if (error.response.status === 502 || error.response.status === 504) {
      return 'API server unreachable (502). The server may have crashed or is still waking up — wait 30s and refresh.';
    }
    if (error.response.status === 503) {
      const msg = error.response.data?.error;
      if (typeof msg === 'string' && msg.includes('starting')) {
        return 'Server is still starting — wait a few seconds and refresh.';
      }
    }
    if (error.response.status >= 500) {
      const msg = error.response.data?.error;
      if (typeof msg === 'string' && msg.trim()) {
        if (msg.includes('Mongo operation timed out') || msg.includes('MongoDB temporarily unavailable')) {
          return 'Compendium database is slow — using cached data. It should recover shortly.';
        }
        return msg;
      }
      return 'Compendium server error. Check the server console.';
    }
  }
  return 'Compendium unavailable. If MongoDB is down, the server should still use local Owlbear JSON — check that pnpm dev is running.';
}

function buildSearchParams(
  browseMode: CompendiumBrowseMode,
  selectedSource: string | null,
  query: string,
) {
  const base: Record<string, string | number | boolean> = { q: query, limit: PAGE_SIZE };
  if (browseMode === 'homebrew') base.isCustom = true;
  if (browseMode === 'sources' && selectedSource) base.source = selectedSource;
  return base;
}

export function CompendiumSidebarList() {
  const tab = useCompendiumUiStore((s) => s.tab);
  const browseMode = useCompendiumUiStore((s) => s.browseMode);
  const selectedSource = useCompendiumUiStore((s) => s.selectedSource);
  const query = useCompendiumUiStore((s) => s.query);
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const setTab = useCompendiumUiStore((s) => s.setTab);
  const setBrowseMode = useCompendiumUiStore((s) => s.setBrowseMode);
  const setSelectedSource = useCompendiumUiStore((s) => s.setSelectedSource);
  const setQuery = useCompendiumUiStore((s) => s.setQuery);
  const selectMonster = useCompendiumUiStore((s) => s.selectMonster);
  const selectItem = useCompendiumUiStore((s) => s.selectItem);
  const selectSpell = useCompendiumUiStore((s) => s.selectSpell);
  const startCreate = useCompendiumUiStore((s) => s.startCreate);
  const selectedMonsterId = useCompendiumUiStore((s) => s.selectedMonsterId);
  const selectedItemId = useCompendiumUiStore((s) => s.selectedItemId);
  const selectedSpellId = useCompendiumUiStore((s) => s.selectedSpellId);
  const { isSignedIn } = useAuth();
  const isAdmin = useCompendiumEditor();
  const qc = useQueryClient();
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [reloadingCatalog, setReloadingCatalog] = useState(false);

  const compendiumReady = Boolean(isSignedIn);

  const deleteMut = useMutation({
    mutationFn: async ({ kind, id }: { kind: CompendiumTab; id: string }) => {
      if (kind === 'monsters') await deleteMonster(id);
      else if (kind === 'items') await deleteItem(id);
      else await deleteSpell(id);
    },
    onSuccess: (_data, { kind, id }) => {
      void qc.invalidateQueries({ queryKey: ['compendium'] });
      const store = useCompendiumUiStore.getState();
      if (kind === 'monsters' && store.selectedMonsterId === id) store.selectMonster(null);
      else if (kind === 'items' && store.selectedItemId === id) store.selectItem(null);
      else if (kind === 'spells' && store.selectedSpellId === id) store.selectSpell(null);
    },
  });

  const sourceLockMut = useMutation({
    mutationFn: async ({ sourceLabel, locked }: { sourceLabel: string; locked: boolean }) => {
      if (locked) return unlockCompendiumSource(sourceLabel);
      return lockCompendiumSource(sourceLabel);
    },
    onMutate: async ({ sourceLabel, locked }) => {
      const nextLocked = !locked;
      await qc.cancelQueries({ queryKey: ['compendium'] });
      patchCompendiumSourceLock(qc, sourceLabel, nextLocked);
      return { sourceLabel, nextLocked };
    },
    onSuccess: (policy, { sourceLabel, locked }) => {
      const nextLocked = !locked;
      applyCompendiumLockPolicy(qc, policy, sourceLabel, nextLocked, isAdmin);
      setLockMessage(nextLocked ? 'Source locked — admin review only' : 'Source unlocked — visible to players');
      window.setTimeout(() => setLockMessage(null), 2500);
      void refetchCompendiumAfterLock(qc);
    },
    onError: (err: Error, _vars, context) => {
      if (context) patchCompendiumSourceLock(qc, context.sourceLabel, !context.nextLocked);
      setLockMessage(err.message || 'Lock failed — unlock admin mode first');
      window.setTimeout(() => setLockMessage(null), 4000);
    },
  });

  function handleDelete(name: string, id: string) {
    if (!window.confirm(`Remove "${name}" from the compendium?`)) return;
    deleteMut.mutate({ kind: tab, id });
  }

  const searchParams = useMemo(
    () => buildSearchParams(browseMode, selectedSource, debouncedQuery),
    [browseMode, selectedSource, debouncedQuery],
  );

  const showSourcePicker = browseMode === 'sources' && !selectedSource;
  const showEntryList = browseMode !== 'sources' || Boolean(selectedSource);
  const inBookView = browseMode === 'sources' && Boolean(selectedSource);

  const sourcesQ = useQuery({
    queryKey: ['compendium', 'sources', 'books', isAdmin],
    queryFn: () => fetchBookSources(),
    enabled: compendiumReady && browseMode === 'sources',
    staleTime: 5_000,
    refetchOnMount: 'always',
    retry: 2,
  });

  const monsterQ = useInfiniteQuery({
    queryKey: ['compendium', 'monsters', searchParams],
    queryFn: ({ pageParam }) => searchMonsters({ ...searchParams, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const next = last.page + 1;
      return next * last.limit < last.total ? next : undefined;
    },
    enabled: compendiumReady && tab === 'monsters' && showEntryList,
    retry: 1,
    staleTime: 5_000,
  });

  const itemQ = useInfiniteQuery({
    queryKey: ['compendium', 'items', searchParams],
    queryFn: ({ pageParam }) => searchItems({ ...searchParams, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const next = last.page + 1;
      return next * last.limit < last.total ? next : undefined;
    },
    enabled: compendiumReady && tab === 'items' && showEntryList,
    retry: 1,
    staleTime: 5_000,
  });

  const spellQ = useInfiniteQuery({
    queryKey: ['compendium', 'spells', searchParams],
    queryFn: ({ pageParam }) => searchSpells({ ...searchParams, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => {
      const next = last.page + 1;
      return next * last.limit < last.total ? next : undefined;
    },
    enabled: compendiumReady && tab === 'spells' && showEntryList,
    retry: 1,
    staleTime: 5_000,
  });

  const activeQ = tab === 'monsters' ? monsterQ : tab === 'items' ? itemQ : spellQ;
  const loading = showSourcePicker
    ? sourcesQ.isLoading
    : activeQ.isPending && !activeQ.isError && !activeQ.data;
  const fetching = showSourcePicker ? sourcesQ.isFetching : activeQ.isFetching;
  const unavailable = showSourcePicker ? sourcesQ.isError : activeQ.isError;

  const activeError = showSourcePicker ? sourcesQ.error : activeQ.error;
  const authBlocked = isApiAuthError(activeError) || (showSourcePicker && isApiAuthError(sourcesQ.error));

  async function handleReloadCompendium() {
    setReloadingCatalog(true);
    try {
      await reloadCompendiumCatalog(qc);
    } finally {
      setReloadingCatalog(false);
    }
  }

  const monsterEntries = useMemo(
    () => {
      const rows = tab === 'monsters' ? monsterQ.data?.pages.flatMap((p) => p.items) ?? [] : [];
      return isAdmin ? rows : rows.filter((m) => !m.isDraft);
    },
    [tab, monsterQ.data?.pages, isAdmin],
  );
  const itemEntries = useMemo(
    () => {
      const rows = tab === 'items' ? itemQ.data?.pages.flatMap((p) => p.items) ?? [] : [];
      return isAdmin ? rows : rows.filter((i) => !i.isDraft);
    },
    [tab, itemQ.data?.pages, isAdmin],
  );
  const spellEntries = useMemo(
    () => {
      const rows = tab === 'spells' ? spellQ.data?.pages.flatMap((p) => p.items) ?? [] : [];
      return isAdmin ? rows : rows.filter((s) => !s.isDraft);
    },
    [tab, spellQ.data?.pages, isAdmin],
  );

  const total = activeQ.data?.pages[0]?.total ?? 0;

  const filteredSources = useMemo(() => {
    const list = sourcesQ.data ?? [];
    // Books tab shows player-visible sources only — locked books stay in admin All/drafts.
    const visible = list.filter((s) => !s.locked);
    const q = query.trim().toLowerCase();
    if (!q) return visible;
    return visible.filter((s) => s.label.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }, [sourcesQ.data, query]);

  const selectedSourceMeta = sourcesQ.data?.find((s) => s.id === selectedSource);
  const selectedSourceLabel = selectedSourceMeta?.label ?? selectedSource;

  const hasMore = activeQ.hasNextPage;

  return (
    <div className="panel space-y-1.5 flex flex-col flex-1 min-h-0 !p-2 overflow-hidden">
      <div className="flex items-center justify-between gap-1 shrink-0">
        <h3 className="font-display text-xs font-semibold tracking-wider uppercase" style={{ color: GOLD }}>
          Compendium
        </h3>
        <CompendiumAdminUnlock />
      </div>

      {/* Type tabs */}
      <div className="flex gap-0.5 shrink-0">
        {(['monsters', 'items', 'spells'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="text-xs px-1.5 py-0.5 rounded capitalize flex-1"
            style={browseBtnStyle(tab === t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Browse mode — hidden when viewing a book list (saves vertical space) */}
      {!inBookView && (
        <div className="flex gap-0.5 shrink-0">
          {([
            ['all', 'All'],
            ['sources', 'Books'],
            ['homebrew', 'Homebrew'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setBrowseMode(mode)}
              className="text-xs px-1.5 py-0.5 rounded flex-1"
              style={browseBtnStyle(browseMode === mode)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {inBookView && (
        <div className="flex items-center gap-1 shrink-0 min-w-0">
          <button
            type="button"
            className="font-ui text-xs text-left flex-1 truncate hover:opacity-80"
            style={{ color: GOLD }}
            onClick={() => setSelectedSource(null)}
            title={selectedSourceLabel ?? undefined}
          >
            ← {selectedSourceLabel}
            {selectedSourceMeta?.locked && (
              <span style={{ color: '#fbbf24', fontSize: 9 }}> · locked</span>
            )}
          </button>
          {isAdmin && selectedSource && (
            <button
              type="button"
              title={selectedSourceMeta?.locked ? 'Unlock source' : 'Lock source for admin review'}
              disabled={sourceLockMut.isPending}
              className="shrink-0 px-1 text-xs opacity-70 hover:opacity-100"
              style={{ color: selectedSourceMeta?.locked ? '#fbbf24' : 'var(--color-text-secondary)' }}
              onClick={() => {
                sourceLockMut.mutate({
                  sourceLabel: selectedSource,
                  locked: Boolean(selectedSourceMeta?.locked),
                });
              }}
            >
              {selectedSourceMeta?.locked ? '🔓' : '🔒'}
            </button>
          )}
        </div>
      )}

      <input
        className="input-dark text-xs py-0.5 w-full shrink-0"
        placeholder={showSourcePicker ? 'Search books…' : 'Search entries…'}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {!inBookView && (
        <button className="btn-ghost w-full text-xs py-0.5 shrink-0" onClick={startCreate}>
          + New {tab === 'monsters' ? 'monster' : tab === 'items' ? 'item' : 'spell'}
        </button>
      )}

      {unavailable && (
        <div className="space-y-1 shrink-0">
          <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-accent-red-hot)' }}>
            {compendiumErrorHint(activeError)}
          </p>
          {authBlocked && (
            <button
              type="button"
              className="btn-ghost w-full text-xs py-0.5"
              disabled={reloadingCatalog}
              onClick={() => void handleReloadCompendium()}
            >
              {reloadingCatalog ? 'Reloading compendium…' : 'Reload compendium'}
            </button>
          )}
        </div>
      )}

      {lockMessage && (
        <p className="font-ui text-[10px] shrink-0" style={{ color: GOLD }}>{lockMessage}</p>
      )}

      <div className="flex-1 min-h-[5rem] overflow-y-auto space-y-0.5">
        {loading && (
          <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Loading…</p>
        )}
        {!loading && fetching && (
          <p className="font-ui text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Updating…</p>
        )}

        {/* Source book picker */}
        {!loading && !unavailable && showSourcePicker && filteredSources.length === 0 && (
          <div className="space-y-1.5">
            <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
              {query.trim()
                ? 'No source books match your search.'
                : sourcesQ.isSuccess && (sourcesQ.data?.length ?? 0) === 0
                  ? 'No imported books yet. Use D&D Beyond Library → Import all, then Sync compendium. Bundled books are hidden here.'
                  : sourcesQ.isSuccess && (sourcesQ.data?.length ?? 0) > 0
                    ? 'All source books are hidden (locked). Unlock a book in admin mode or import from D&D Beyond.'
                    : 'Loading book list…'}
            </p>
            {!query.trim() && (
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="btn-ghost w-full text-xs py-0.5"
                  onClick={() => void sourcesQ.refetch()}
                >
                  Refresh book list
                </button>
                <button
                  type="button"
                  className="btn-ghost w-full text-xs py-0.5"
                  onClick={() => setBrowseMode('all')}
                >
                  Browse all {tab}
                </button>
              </div>
            )}
          </div>
        )}
        {!loading && showSourcePicker && filteredSources.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            isAdmin={isAdmin}
            lockPending={sourceLockMut.isPending}
            onSelect={() => { setSelectedSource(source.id); setQuery(''); }}
            onToggleLock={() => {
              sourceLockMut.mutate({ sourceLabel: source.id, locked: Boolean(source.locked) });
            }}
          />
        ))}

        {/* Entry lists */}
        {!loading && !unavailable && showEntryList && (
          (tab === 'monsters' ? monsterEntries.length : tab === 'items' ? itemEntries.length : spellEntries.length) === 0
        ) && (
          <div className="space-y-1.5">
            <p className="font-ui text-xs leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
              {browseMode === 'homebrew'
                ? `No homebrew ${tab} yet.`
                : debouncedQuery.trim()
                  ? `No ${tab} match your search.`
                  : browseMode === 'sources' && selectedSource
                    ? `No ${tab} found in “${selectedSourceLabel}”. Try Items or Spells, or run D&D Beyond Library → Sync compendium.`
                    : `No ${tab} in the catalog. Run D&D Beyond Library → Sync compendium if you recently imported.`}
            </p>
            {browseMode === 'sources' && selectedSource && (
              <button
                type="button"
                className="btn-ghost w-full text-xs py-0.5"
                onClick={() => { setSelectedSource(null); setBrowseMode('all'); }}
              >
                Browse all {tab}
              </button>
            )}
          </div>
        )}
        {showEntryList && tab === 'monsters' && monsterEntries.map((monster) => (
          <EntryRow
            key={monster.id}
            name={monster.name}
            sub={`CR ${monster.cr}`}
            showHomebrew={isHomebrewEntry(monster.isCustom, monster.source)}
            showDraft={Boolean(monster.isDraft)}
            selected={monster.id === selectedMonsterId}
            onClick={() => {
              prefetchCompendiumEntry(qc, 'monsters', monster.id);
              selectMonster(monster.id);
            }}
            {...(isAdmin ? { onDelete: () => handleDelete(monster.name, monster.id) } : {})}
          />
        ))}
        {showEntryList && tab === 'items' && itemEntries.map((item) => (
          <EntryRow
            key={item.id}
            name={item.name}
            showHomebrew={isHomebrewEntry(item.isCustom, item.source)}
            showDraft={Boolean(item.isDraft)}
            selected={item.id === selectedItemId}
            onClick={() => {
              prefetchCompendiumEntry(qc, 'items', item.id);
              selectItem(item.id);
            }}
            {...(isAdmin ? { onDelete: () => handleDelete(item.name, item.id) } : {})}
          />
        ))}
        {showEntryList && tab === 'spells' && spellEntries.map((spell) => (
          <EntryRow
            key={spell.id}
            name={spell.name}
            sub={`Lvl ${spell.level}`}
            showHomebrew={isHomebrewEntry(spell.isCustom, spell.source)}
            showDraft={Boolean(spell.isDraft)}
            selected={spell.id === selectedSpellId}
            onClick={() => {
              prefetchCompendiumEntry(qc, 'spells', spell.id);
              selectSpell(spell.id);
            }}
            {...(isAdmin ? { onDelete: () => handleDelete(spell.name, spell.id) } : {})}
          />
        ))}

        {showEntryList && !loading && hasMore && (
          <button
            type="button"
            className="btn-ghost w-full text-xs py-1 mt-1"
            disabled={activeQ.isFetchingNextPage}
            onClick={() => activeQ.fetchNextPage()}
          >
            {activeQ.isFetchingNextPage ? 'Loading…' : `Load more (${total - (tab === 'monsters' ? monsterEntries.length : tab === 'items' ? itemEntries.length : spellEntries.length)} remaining)`}
          </button>
        )}
      </div>
    </div>
  );
}

function SourceRow({
  source,
  isAdmin,
  lockPending,
  onSelect,
  onToggleLock,
}: {
  source: CompendiumSource;
  isAdmin: boolean;
  lockPending: boolean;
  onSelect: () => void;
  onToggleLock: () => void;
}) {
  return (
    <div className="flex items-stretch gap-0.5">
      <button
        type="button"
        onClick={onSelect}
        className="flex-1 min-w-0 text-left px-1.5 py-1.5 rounded text-xs font-ui hover:opacity-90"
        style={{ background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)' }}
      >
        <span className="block truncate">
          {source.label}
          {source.locked && (
            <span style={{ color: '#fbbf24', fontSize: 9 }}> · admin only</span>
          )}
        </span>
        <span style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>
          {source.count} entries
          {source.draftCount ? ` · ${source.draftCount} draft` : ''}
        </span>
      </button>
      {isAdmin && (
        <button
          type="button"
          title={source.locked ? 'Unlock source (public)' : 'Lock source (admin review)'}
          disabled={lockPending}
          onClick={(e) => { e.stopPropagation(); onToggleLock(); }}
          className="shrink-0 px-1.5 rounded text-xs opacity-70 hover:opacity-100 transition-opacity"
          style={{ color: source.locked ? '#fbbf24' : 'var(--color-text-secondary)', background: 'var(--color-bg-primary)' }}
        >
          {source.locked ? '🔓' : '🔒'}
        </button>
      )}
    </div>
  );
}

function EntryRow({
  name,
  sub,
  showHomebrew,
  showDraft = false,
  selected = false,
  onClick,
  onDelete,
}: {
  name: string;
  sub?: string;
  showHomebrew: boolean;
  showDraft?: boolean;
  selected?: boolean;
  onClick: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-stretch gap-0.5">
      <button
        type="button"
        onClick={onClick}
        className="flex-1 min-w-0 text-left px-1.5 py-1 rounded text-xs font-ui hover:opacity-90"
        style={{
          background: selected ? 'rgba(201,168,76,0.15)' : 'var(--color-bg-primary)',
          color: 'var(--color-text-primary)',
          border: selected ? '1px solid var(--color-border-gold)' : '1px solid transparent',
        }}
      >
        <span className="truncate block">
          {name}
          {showDraft && <span style={{ color: '#fbbf24', fontSize: 9 }}> · draft</span>}
          {showHomebrew && <span style={{ color: '#60a5fa', fontSize: 9 }}> · homebrew</span>}
        </span>
        {sub && <span style={{ color: 'var(--color-text-secondary)', fontSize: 9 }}>{sub}</span>}
      </button>
      {onDelete && (
        <button
          type="button"
          title="Remove from compendium"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="shrink-0 px-1.5 rounded text-xs opacity-50 hover:opacity-100 transition-opacity"
          style={{ color: 'var(--color-accent-red-hot)', background: 'var(--color-bg-primary)' }}
        >
          ✕
        </button>
      )}
    </div>
  );
}
