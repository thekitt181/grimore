import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import { useSessionStore } from '@/store/sessionStore';
import {
  fetchDdbLibrarySources,
  fetchDdbStatus,
  fetchGrimoireDdbLink,
  importDdbLibraryEntries,
  formatDdbImportJobProgress,
  syncCompendiumAfterImport,
  searchDdbLibraryItems,
  searchDdbLibraryMonsters,
  searchDdbLibrarySpells,
} from './ddbApi';
import { useDdbImportJob } from './useDdbImportJob';
import { fetchSources, lockCompendiumSource, unlockCompendiumSource } from '@/systems/compendium/compendiumApi';
import {
  applyCompendiumLockPolicy,
  patchCompendiumSourceLock,
  refetchCompendiumAfterImport,
  refetchCompendiumAfterLock,
  sourceIdsMatch,
} from '@/systems/compendium/compendiumLockCache';
import type { DdbLibraryImportResult } from '@grimoire/shared';
import { DDB_HOMEBREW_SOURCE_ID } from '@grimoire/shared';
import { useCompendiumEditor } from '@/systems/compendium/useCompendiumEditor';
import { useCompendiumUiStore } from '@/systems/compendium/compendiumStore';
import { extractApiError } from '@/lib/apiError';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

type LibraryTab = 'monsters' | 'spells' | 'items';

const SOURCE_STORAGE_KEY = 'grimoire-ddb-library-source-ids';

function loadSavedSourceIds(): Set<number> {
  try {
    const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && (id > 0 || id === DDB_HOMEBREW_SOURCE_ID)),
    );
  } catch {
    return new Set();
  }
}

function tabToKind(tab: LibraryTab): 'monster' | 'item' | 'spell' {
  if (tab === 'monsters') return 'monster';
  if (tab === 'spells') return 'spell';
  return 'item';
}

function formatImportResultMessage(result: DdbLibraryImportResult, base: string): string {
  let msg = base;
  if (result.skipped && result.skipped > 0) {
    msg += ` Skipped ${result.skipped} already in compendium.`;
  }
  if (result.errors.length > 0) {
    const byMessage = new Map<string, number>();
    for (const err of result.errors) {
      byMessage.set(err.message, (byMessage.get(err.message) ?? 0) + 1);
    }
    const summary = [...byMessage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([text, count]) => `${count}× ${text}`)
      .join('; ');
    msg += ` Failures: ${summary}.`;
  }
  if (result.mongoPersisted === false) {
    msg += ' Warning: compendium save failed — try Sync compendium or re-import.';
  }
  return msg;
}

async function afterCompendiumImport(
  qc: QueryClient,
  result: DdbLibraryImportResult,
): Promise<void> {
  if (result.imported.length === 0) return;
  useCompendiumUiStore.getState().setBrowseMode('sources');
  useCompendiumUiStore.getState().setPanelOpen(true);
  await refetchCompendiumAfterImport(
    qc,
    result.catalogRev ? { catalogRev: result.catalogRev } : undefined,
  );
}

export function DdbLibraryPanel({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const campaignId = useSessionStore((s) => s.campaignId);
  const isEditor = useCompendiumEditor();
  const [tab, setTab] = useState<LibraryTab>('monsters');
  const [q, setQ] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(loadSavedSourceIds);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [sourcesSaved, setSourcesSaved] = useState(false);

  const { data: ddbStatus } = useQuery({
    queryKey: ['ddb', 'status'],
    queryFn: fetchDdbStatus,
  });

  const importJob = useDdbImportJob(Boolean(ddbStatus?.linked));

  useEffect(() => {
    const job = importJob.job;
    if (!job) return;
    const verb = job.skipExisting ? 'reimport' : 'import';
    if (job.status === 'running') {
      setMessage(
        job.progress
          ? formatDdbImportJobProgress(job.progress, verb)
          : `Background ${verb} started — you can refresh or close this tab.`,
      );
      return;
    }
    if (job.status === 'completed' && job.result) {
      const ok = job.result.imported.length;
      const skipped = job.result.skipped ?? 0;
      const fail = job.result.errors.length;
      if (job.skipExisting) {
        setMessage(
          ok || skipped
            ? formatImportResultMessage(
                job.result,
                ok
                  ? `Reimported ${ok} missing entries${fail ? ` (${fail} failed)` : ''}.`
                  : `All entries already in compendium${fail ? ` (${fail} failed)` : ''}.`,
              )
            : fail
              ? job.result.errors.map((e) => e.message).join('; ')
              : 'Nothing to reimport from the selected books.',
        );
      } else {
        const byKind = job.result.imported.reduce(
          (acc, entry) => {
            acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const breakdown = ['monster', 'spell', 'item']
          .filter((k) => byKind[k])
          .map((k) => `${byKind[k]} ${k}${byKind[k] === 1 ? '' : 's'}`)
          .join(', ');
        setMessage(
          ok
            ? formatImportResultMessage(
                job.result,
                `Imported ${ok} entries (${breakdown})${fail ? ` — ${fail} failed` : ''}. Open Compendium → Books.`,
              )
            : fail
              ? job.result.errors.map((e) => e.message).join('; ')
              : 'Nothing to import from the selected books.',
        );
      }
      return;
    }
    if (job.status === 'failed') {
      setMessage(job.errorMessage ?? `${verb} failed`);
    } else if (job.status === 'cancelled') {
      setMessage(job.errorMessage ?? `${verb} cancelled`);
    }
  }, [importJob.job]);

  const { data: compendiumSources = [] } = useQuery({
    queryKey: ['compendium', 'sources', tab],
    queryFn: () => fetchSources(tab),
    enabled: isEditor && Boolean(ddbStatus?.linked),
    staleTime: 30_000,
  });

  const sourceLockMut = useMutation({
    mutationFn: async ({ sourceName, locked }: { sourceName: string; locked: boolean }) => {
      const meta = compendiumSources.find(
        (s) => sourceIdsMatch(s.label, sourceName) || sourceIdsMatch(s.id, sourceName),
      );
      const label = meta?.id ?? sourceName;
      if (locked) return unlockCompendiumSource(label);
      return lockCompendiumSource(label);
    },
    onMutate: async ({ sourceName, locked }) => {
      const meta = compendiumSources.find(
        (s) => sourceIdsMatch(s.label, sourceName) || sourceIdsMatch(s.id, sourceName),
      );
      const label = meta?.id ?? sourceName;
      const nextLocked = !locked;
      await qc.cancelQueries({ queryKey: ['compendium'] });
      patchCompendiumSourceLock(qc, label, nextLocked);
      return { label, nextLocked };
    },
    onSuccess: (policy, { sourceName, locked }) => {
      const meta = compendiumSources.find(
        (s) => sourceIdsMatch(s.label, sourceName) || sourceIdsMatch(s.id, sourceName),
      );
      const label = meta?.id ?? sourceName;
      const nextLocked = !locked;
      applyCompendiumLockPolicy(qc, policy, label, nextLocked, isEditor);
      setMessage(nextLocked ? 'Book locked — admin review only in compendium' : 'Book unlocked in compendium');
      void refetchCompendiumAfterLock(qc);
    },
    onError: (err: Error, _vars, context) => {
      if (context) patchCompendiumSourceLock(qc, context.label, !context.nextLocked);
      setMessage(err.message || 'Could not lock source');
    },
  });

  function compendiumSourceLocked(name: string): boolean {
    const meta = compendiumSources.find(
      (s) => sourceIdsMatch(s.label, name) || sourceIdsMatch(s.id, name),
    );
    return Boolean(meta?.locked);
  }

  const { data: link } = useQuery({
    queryKey: ['ddb', 'campaign-link', campaignId],
    queryFn: () => (campaignId ? fetchGrimoireDdbLink(campaignId) : null),
    enabled: Boolean(campaignId),
  });

  const ddbCampaignId = link?.ddbCampaignId;

  const { data: sources = [], isLoading: sourcesLoading } = useQuery({
    queryKey: ['ddb', 'library', 'sources', ddbCampaignId ?? null],
    queryFn: () =>
      fetchDdbLibrarySources(
        ddbCampaignId != null && ddbCampaignId > 0 ? { campaignId: ddbCampaignId } : undefined,
      ),
    enabled: Boolean(ddbStatus?.linked),
    staleTime: 5 * 60_000,
  });

  async function refreshSourceBooks() {
    setMessage('Refreshing your D&D Beyond library…');
    try {
      const fresh = await fetchDdbLibrarySources({
        refresh: true,
        ...(ddbCampaignId != null && ddbCampaignId > 0 ? { campaignId: ddbCampaignId } : {}),
      });
      qc.setQueryData(['ddb', 'library', 'sources', ddbCampaignId ?? null], fresh);
      setMessage(`Refreshed — ${fresh.length} accessible source${fresh.length === 1 ? '' : 's'}.`);
    } catch (err: unknown) {
      setMessage(extractApiError(err, 'Could not refresh source books'));
    }
  }

  useEffect(() => {
    if (sources.length === 0) return;
    const valid = new Set(sources.map((s) => s.id));
    setSelectedSourceIds((prev) => {
      const next = new Set([...prev].filter((id) => valid.has(id)));
      if (next.size === prev.size && [...next].every((id) => prev.has(id))) return prev;
      return next;
    });
  }, [sources]);

  function saveSourceSelection() {
    localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify([...selectedSourceIds]));
    setSourcesSaved(true);
    setMessage('Saved source book selection.');
    window.setTimeout(() => setSourcesSaved(false), 2000);
  }

  const searchParams = useMemo(() => {
    const trimmed = q.trim();
    const sourceIds = [...selectedSourceIds];
    return {
      ...(trimmed ? { q: trimmed } : {}),
      ...(sourceIds.length > 0 ? { sourceIds } : {}),
      ...(ddbCampaignId ? { campaignId: ddbCampaignId } : {}),
    };
  }, [q, selectedSourceIds, ddbCampaignId]);

  const monstersQ = useQuery({
    queryKey: ['ddb', 'library', 'monsters', searchParams],
    queryFn: () => searchDdbLibraryMonsters({ ...searchParams, take: 60 }),
    enabled: Boolean(ddbStatus?.linked) && tab === 'monsters',
  });

  const spellsQ = useQuery({
    queryKey: ['ddb', 'library', 'spells', searchParams],
    queryFn: () => searchDdbLibrarySpells({ ...searchParams, limit: 300 }),
    enabled: Boolean(ddbStatus?.linked) && tab === 'spells',
    retry: 1,
  });

  const itemsQ = useQuery({
    queryKey: ['ddb', 'library', 'items', searchParams],
    queryFn: () => searchDdbLibraryItems({ ...searchParams, limit: 300 }),
    enabled: Boolean(ddbStatus?.linked) && tab === 'items',
    retry: 1,
  });

  const importMut = useMutation({
    mutationFn: () =>
      importDdbLibraryEntries({
        kind: tabToKind(tab),
        ids: [...selected],
        ...(selectedSourceIds.size === 1 ? { sourceId: [...selectedSourceIds][0]! } : {}),
        ...(ddbCampaignId ? { campaignId: ddbCampaignId } : {}),
      }),
    onSuccess: async (result) => {
      const ok = result.imported.length;
      const fail = result.errors.length;
      setMessage(
        ok
          ? formatImportResultMessage(
              result,
              `Imported ${ok} ${tab}${fail ? ` (${fail} failed)` : ''}. Open Compendium → All to browse.`,
            )
          : fail
            ? result.errors.map((e) => e.message).join('; ')
            : 'Nothing imported.',
      );
      setSelected(new Set());
      await afterCompendiumImport(qc, result);
    },
    onError: (err: unknown) => setMessage(extractApiError(err, 'Import failed')),
  });

  async function startBulkImport(skipExisting: boolean) {
    if (selectedSourceIds.size === 0) throw new Error('Select at least one source book');
    const sourceNames = Object.fromEntries(sources.map((s) => [s.id, s.name]));
    const total = selectedSourceIds.size;
    setMessage(
      skipExisting
        ? `Starting background reimport of ${total} book${total === 1 ? '' : 's'}…`
        : `Starting background import of ${total} book${total === 1 ? '' : 's'}…`,
    );
    await importJob.startImport({
      sourceIds: [...selectedSourceIds].map((id) => Number(id)),
      sourceNames,
      skipExisting,
      ...(ddbCampaignId != null && ddbCampaignId > 0 ? { campaignId: ddbCampaignId } : {}),
    });
  }

  const syncCatalogMut = useMutation({
    mutationFn: () =>
      syncCompendiumAfterImport({
        ...(selectedSourceIds.size > 0 ? { sourceIds: [...selectedSourceIds] } : {}),
        unlockAllImportedSources: true,
      }),
    onSuccess: async (result) => {
      const unlocked = result.sourcesUnlocked?.length ?? 0;
      setMessage(
        unlocked > 0
          ? `Compendium synced — ${unlocked} book${unlocked === 1 ? '' : 's'} unlocked. Open Compendium → Books.`
          : 'Compendium catalog rebuilt. Open Compendium → Books to browse imported sources.',
      );
      useCompendiumUiStore.getState().setBrowseMode('sources');
      useCompendiumUiStore.getState().setPanelOpen(true);
      await refetchCompendiumAfterImport(qc, result.catalogRev ? { catalogRev: result.catalogRev } : undefined);
    },
    onError: (err: unknown) => setMessage(extractApiError(err, 'Could not sync compendium')),
  });

  function toggleSourceId(id: number) {
    setSelectedSourceIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelected(new Set());
  }

  function selectAllSources() {
    setSelectedSourceIds(new Set(sources.map((s) => s.id)));
    setSelected(new Set());
    if (sources.length > 0) {
      setMessage(`Selected all ${sources.length} accessible book${sources.length === 1 ? '' : 's'}.`);
    }
  }

  function clearSourceSelection() {
    setSelectedSourceIds(new Set());
    setSelected(new Set());
  }

  function toggleId(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function switchTab(next: LibraryTab) {
    setTab(next);
    setSelected(new Set());
    setMessage(null);
  }

  const loading =
    tab === 'monsters' ? monstersQ.isLoading : tab === 'spells' ? spellsQ.isLoading : itemsQ.isLoading;

  const listError =
    tab === 'monsters'
      ? monstersQ.error instanceof Error
        ? monstersQ.error.message
        : null
      : tab === 'spells'
        ? spellsQ.error instanceof Error
          ? spellsQ.error.message
          : null
        : itemsQ.error instanceof Error
          ? itemsQ.error.message
          : null;

  const selectedSourceNames = sources
    .filter((s) => selectedSourceIds.has(s.id))
    .map((s) => s.name);

  const bulkImportActive = importJob.isRunning || importJob.isStarting;
  const bulkImportVerb = importJob.verb;
  const jobProgress = importJob.job?.progress ?? null;
  const progressLabel = jobProgress
    ? formatDdbImportJobProgress(jobProgress, bulkImportVerb)
    : message;
  const progressPercent = importJob.progressPercent;

  function shortProgressLabel(): string | null {
    if (!jobProgress) return bulkImportActive ? 'Background…' : null;
    const book =
      jobProgress.bookIndex != null && jobProgress.bookTotal != null
        ? `${jobProgress.bookIndex}/${jobProgress.bookTotal}`
        : null;
    if (jobProgress.phase.startsWith('listing-')) {
      const kind = jobProgress.phase.replace('listing-', '');
      return book ? `${book} · listing ${kind}…` : `Listing ${kind}…`;
    }
    if (jobProgress.phase === 'complete') return book ? `${book} · done` : 'Done';
    const count = jobProgress.total > 0 ? ` ${jobProgress.done}/${jobProgress.total}` : '';
    return book
      ? `${book} · ${jobProgress.phase}${count}`
      : `${jobProgress.phase}${count}`;
  }

  async function handleBulkImport(skipExisting: boolean) {
    try {
      await startBulkImport(skipExisting);
    } catch (err: unknown) {
      setMessage(extractApiError(err, skipExisting ? 'Reimport failed' : 'Import failed'));
    }
  }

  return (
    <DraggablePanel
      title="DDB Library Import"
      subtitle="Browse & import from D&D Beyond"
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 520) / 2), y: 64 }}
      width={520}
      maxHeight="85vh"
      zIndex={140}
      footer="Powered by D&D Beyond"
    >
      <div className="p-4 flex flex-col min-h-0 flex-1">
      <p className="font-ui text-[10px] mb-3 shrink-0" style={{ color: 'var(--color-text-secondary)' }}>
        Browse monsters, spells, and items from books you own or that are shared with you on D&amp;D Beyond.
        {ddbCampaignId
          ? ' Using linked campaign for shared content.'
          : ' Link a DDB campaign for campaign-shared books.'}
      </p>

      {!ddbStatus?.linked ? (
        <p className="font-ui text-xs" style={{ color: '#f87171' }}>
          Link your D&amp;D Beyond account first (Account link in sidebar).
        </p>
      ) : (
        <>
          <div className="flex gap-1 mb-2 shrink-0">
            {(['monsters', 'spells', 'items'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => switchTab(t)}
                className="font-ui text-[10px] px-2 py-1 rounded capitalize"
                style={{
                  background: tab === t ? 'rgba(201,168,76,0.2)' : 'transparent',
                  border: `1px solid ${tab === t ? GOLD : BD}`,
                  color: tab === t ? GOLD : 'var(--color-text-secondary)',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          <div className="flex gap-2 mb-2 shrink-0">
            <input
              className="input-dark text-xs py-1 flex-1"
              placeholder="Search…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>

          <div
            className="mb-2 shrink-0 rounded p-2 max-h-28 overflow-y-auto"
            style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-ui text-[10px] font-semibold" style={{ color: GOLD }}>
                Source books
                {selectedSourceIds.size > 0 ? ` (${selectedSourceIds.size} selected)` : ''}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  className="font-ui text-[9px] opacity-60 hover:opacity-100"
                  onClick={() => void refreshSourceBooks()}
                  disabled={sourcesLoading}
                  title="Re-fetch owned/shared books from D&D Beyond"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  className="font-ui text-[9px] opacity-60 hover:opacity-100"
                  onClick={saveSourceSelection}
                  disabled={selectedSourceIds.size === 0}
                  title="Remember selected books for next time"
                >
                  {sourcesSaved ? 'Saved' : 'Save'}
                </button>
                <button
                  type="button"
                  className="font-ui text-[9px] opacity-60 hover:opacity-100"
                  onClick={selectAllSources}
                  disabled={sourcesLoading || sources.length === 0}
                >
                  All
                </button>
                <button
                  type="button"
                  className="font-ui text-[9px] opacity-60 hover:opacity-100"
                  onClick={clearSourceSelection}
                  disabled={selectedSourceIds.size === 0}
                >
                  Clear
                </button>
              </span>
            </div>
            {sourcesLoading ? (
              <p className="font-ui text-[10px] opacity-60">Loading your books…</p>
            ) : sources.length === 0 ? (
              <p className="font-ui text-[10px] opacity-60">
                No accessible books found. Sync entitlements on D&amp;D Beyond or link a campaign for shared content.
              </p>
            ) : (
              <div className="space-y-0.5">
                {sources.map((s) => (
                  <div key={s.id} className="flex items-center gap-1 py-0.5">
                    <label className="flex items-center gap-2 cursor-pointer font-ui text-[10px] flex-1 min-w-0">
                      <input
                        type="checkbox"
                        checked={selectedSourceIds.has(s.id)}
                        onChange={() => toggleSourceId(s.id)}
                      />
                      <span className="truncate">
                        {s.name}
                        {s.id === DDB_HOMEBREW_SOURCE_ID && (
                          <span style={{ color: '#60a5fa', fontSize: 9 }}> · homebrew</span>
                        )}
                        {isEditor && s.id !== DDB_HOMEBREW_SOURCE_ID && compendiumSourceLocked(s.name) && (
                          <span style={{ color: '#fbbf24', fontSize: 9 }}> · locked</span>
                        )}
                      </span>
                    </label>
                    {isEditor && s.id !== DDB_HOMEBREW_SOURCE_ID && (
                      <button
                        type="button"
                        title={compendiumSourceLocked(s.name) ? 'Unlock in compendium' : 'Lock in compendium (admin only)'}
                        disabled={sourceLockMut.isPending}
                        className="shrink-0 text-[10px] opacity-60 hover:opacity-100 px-1"
                        style={{ color: compendiumSourceLocked(s.name) ? '#fbbf24' : 'var(--color-text-secondary)' }}
                        onClick={() => sourceLockMut.mutate({
                          sourceName: s.name,
                          locked: compendiumSourceLocked(s.name),
                        })}
                      >
                        {compendiumSourceLocked(s.name) ? '🔓' : '🔒'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1 mb-2">
            {loading && (
              <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {tab === 'spells' || tab === 'items'
                  ? 'Loading from D&D Beyond (first load may take a minute)…'
                  : 'Loading from D&D Beyond…'}
              </p>
            )}

            {listError && (
              <p className="font-ui text-xs" style={{ color: '#f87171' }}>
                {listError}
              </p>
            )}

            {tab === 'monsters' && monstersQ.data?.items.map((m) => (
              <label
                key={m.ddbId}
                className="flex items-start gap-2 rounded px-2 py-1.5 cursor-pointer hover:opacity-90"
                style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(m.ddbId)}
                  onChange={() => toggleId(m.ddbId)}
                  className="mt-0.5"
                />
                <span className="font-ui text-xs flex-1">
                  <span className="font-semibold">{m.name}</span>
                  <span className="opacity-60 ml-1">
                    CR {m.cr}
                    {m.isHomebrew && <span style={{ color: '#60a5fa' }}> · homebrew</span>}
                    {m.source ? ` · ${m.source}` : ''}
                  </span>
                </span>
              </label>
            ))}

            {tab === 'spells' && spellsQ.data?.map((s) => (
              <label
                key={s.ddbId}
                className="flex items-start gap-2 rounded px-2 py-1.5 cursor-pointer hover:opacity-90"
                style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s.ddbId)}
                  onChange={() => toggleId(s.ddbId)}
                  className="mt-0.5"
                />
                <span className="font-ui text-xs flex-1">
                  <span className="font-semibold">{s.name}</span>
                  <span className="opacity-60 ml-1">
                    Lvl {s.level}
                    {s.source ? ` · ${s.source}` : ''}
                  </span>
                </span>
              </label>
            ))}

            {tab === 'items' && itemsQ.data?.map((i) => (
              <label
                key={i.ddbId}
                className="flex items-start gap-2 rounded px-2 py-1.5 cursor-pointer hover:opacity-90"
                style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(i.ddbId)}
                  onChange={() => toggleId(i.ddbId)}
                  className="mt-0.5"
                />
                <span className="font-ui text-xs flex-1">
                  <span className="font-semibold">{i.name}</span>
                  <span className="opacity-60 ml-1">
                    {i.rarity || i.type}
                    {i.source ? ` · ${i.source}` : ''}
                  </span>
                </span>
              </label>
            ))}

            {!loading && tab === 'monsters' && monstersQ.data?.items.length === 0 && (
              <p className="font-ui text-xs opacity-60">No monsters found.</p>
            )}
            {!loading && !listError && tab === 'spells' && (spellsQ.data?.length ?? 0) === 0 && (
              <p className="font-ui text-xs opacity-60">
                No spells found. Select a source book or link a DDB campaign for shared content.
              </p>
            )}
            {!loading && !listError && tab === 'items' && (itemsQ.data?.length ?? 0) === 0 && (
              <p className="font-ui text-xs opacity-60">
                No items found. Select a source book or link a DDB campaign for shared content.
              </p>
            )}
          </div>

          {(message || bulkImportActive) && (
            <div className="mb-2 shrink-0 space-y-1.5">
              {bulkImportActive && progressPercent != null && (
                <div
                  className="h-1.5 w-full rounded overflow-hidden"
                  style={{ background: 'rgba(255,255,255,0.08)' }}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${progressPercent}%`,
                      background: GOLD,
                    }}
                  />
                </div>
              )}
              <p
                className="font-ui text-[10px] leading-snug"
                style={{ color: bulkImportActive ? GOLD : GOLD }}
              >
                {progressLabel}
              </p>
            </div>
          )}

          <div className="flex gap-2 shrink-0 flex-wrap">
            <button
              type="button"
              disabled={selected.size === 0 || importMut.isPending || bulkImportActive || syncCatalogMut.isPending}
              onClick={() => importMut.mutate()}
              className="font-ui text-xs flex-1 py-2 rounded font-semibold disabled:opacity-40"
              style={{
                background: 'rgba(201,168,76,0.15)',
                border: `1px solid ${GOLD}`,
                color: GOLD,
              }}
            >
              {importMut.isPending
                ? 'Importing…'
                : `Import selected${selected.size ? ` (${selected.size})` : ''}`}
            </button>
            <button
              type="button"
              disabled={selectedSourceIds.size === 0 || importMut.isPending || bulkImportActive || syncCatalogMut.isPending}
              onClick={() => void handleBulkImport(false)}
              className="font-ui text-xs flex-1 py-2 rounded font-semibold disabled:opacity-40 min-w-[8rem]"
              style={{
                background: 'rgba(201,168,76,0.08)',
                border: `1px solid ${BD}`,
                color: GOLD,
              }}
              title={
                selectedSourceNames.length > 0
                  ? `Import all monsters, spells & items from: ${selectedSourceNames.join(', ')}`
                  : 'Select one or more source books first'
              }
            >
              {bulkImportActive && bulkImportVerb === 'import'
                ? shortProgressLabel() ?? 'Importing in background…'
                : selectedSourceIds.size > 0
                  ? `Import all types (${selectedSourceIds.size} book${selectedSourceIds.size === 1 ? '' : 's'})`
                  : 'Import all from books'}
            </button>
            <button
              type="button"
              disabled={selectedSourceIds.size === 0 || importMut.isPending || bulkImportActive || syncCatalogMut.isPending}
              onClick={() => void handleBulkImport(true)}
              className="font-ui text-xs flex-1 py-2 rounded font-semibold disabled:opacity-40 min-w-[8rem]"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${BD}`,
                color: GOLD,
              }}
              title="Fast reimport: skips entries already in Mongo; re-fetches spells with broken duration text"
            >
              {bulkImportActive && bulkImportVerb === 'reimport'
                ? shortProgressLabel() ?? 'Reimporting in background…'
                : selectedSourceIds.size > 0
                  ? `Reimport missing (${selectedSourceIds.size} book${selectedSourceIds.size === 1 ? '' : 's'})`
                  : 'Reimport missing'}
            </button>
            <button
              type="button"
              disabled={importMut.isPending || bulkImportActive || syncCatalogMut.isPending}
              onClick={() => syncCatalogMut.mutate()}
              className="font-ui text-xs w-full py-2 rounded font-semibold disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${BD}`,
                color: GOLD,
              }}
              title="Rebuild compendium catalog and unlock imported books after an interrupted import"
            >
              {syncCatalogMut.isPending ? 'Syncing…' : 'Sync compendium'}
            </button>
          </div>
        </>
      )}
      </div>
    </DraggablePanel>
  );
}
