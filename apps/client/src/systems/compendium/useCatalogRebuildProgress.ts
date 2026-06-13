import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogRebuildProgress, CompendiumSyncStatus } from '@grimoire/shared';
import { getSocket } from '@/lib/socket';

export function formatCatalogRebuildLabel(p: CatalogRebuildProgress): string {
  const elapsedSec = Math.max(0, Math.floor((Date.now() - Date.parse(p.startedAt)) / 1000));
  const elapsed = elapsedSec >= 8 ? ` · ${elapsedSec}s` : '';

  const indexed = p.entryCounts
    ? (p.entryCounts.monsters ?? 0) + (p.entryCounts.items ?? 0) + (p.entryCounts.spells ?? 0)
    : 0;
  const imported = p.importCounts
    ? p.importCounts.monsters + p.importCounts.items + p.importCounts.spells
    : 0;
  const showIndexed = indexed > 0 && ['building-items', 'building-spells', 'sorting', 'complete'].includes(p.phase);
  if (showIndexed && p.active) {
    return `${p.label}${elapsed} — ${indexed.toLocaleString()} entries indexed`;
  }
  if (imported > 0 && p.active && (p.phase === 'merging-imports' || p.phase === 'building-monsters')) {
    return `${p.label}${elapsed} — ${imported.toLocaleString()} imports in database`;
  }
  return `${p.label}${elapsed}`;
}

function patchSyncStatus(
  qc: ReturnType<typeof useQueryClient>,
  rebuild: CatalogRebuildProgress | undefined,
): void {
  qc.setQueryData<CompendiumSyncStatus>(['compendium', 'sync-status'], (old) => {
    if (!old) return old;
    if (rebuild?.active) return { ...old, catalogRebuild: rebuild };
    const { catalogRebuild: _removed, ...rest } = old;
    return rest;
  });
}

/** Live catalog rebuild progress via socket + sync-status polling. */
export function useCatalogRebuildProgress(watch = true) {
  const qc = useQueryClient();
  const [live, setLive] = useState<CatalogRebuildProgress | null>(null);
  const [tick, setTick] = useState(0);

  const { data: syncStatus } = useQuery<CompendiumSyncStatus>({
    queryKey: ['compendium', 'sync-status'],
    enabled: watch,
    staleTime: 2_000,
  });

  useEffect(() => {
    if (!watch) {
      setLive(null);
      return;
    }
    const socket = getSocket();
    const onRebuild = (payload: CatalogRebuildProgress) => {
      if (payload.active) {
        setLive(payload);
        patchSyncStatus(qc, payload);
        return;
      }
      setLive(null);
      patchSyncStatus(qc, undefined);
    };
    socket.on('compendium:catalog-rebuild', onRebuild);
    return () => {
      socket.off('compendium:catalog-rebuild', onRebuild);
    };
  }, [watch, qc]);

  useEffect(() => {
    if (!syncStatus?.catalogRebuild?.active) {
      setLive(null);
    }
  }, [syncStatus?.catalogRebuild?.active]);

  const serverRebuild = syncStatus?.catalogRebuild;
  const progress = serverRebuild?.active ? (live ?? serverRebuild) : null;
  const active = Boolean(progress?.active);

  useEffect(() => {
    if (!watch || !active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [watch, active]);

  void tick;

  return {
    active,
    progress,
    percent: progress?.percent ?? null,
    label: progress ? formatCatalogRebuildLabel(progress) : null,
  };
}
