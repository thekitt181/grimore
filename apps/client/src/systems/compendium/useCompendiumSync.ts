import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogRebuildProgress, CompendiumSyncStatus } from '@grimoire/shared';
import { fetchSyncStatus } from './compendiumApi';
import { useCompendiumUiStore } from './compendiumStore';
import { getSocket } from '@/lib/socket';
import { isApiAuthBlocked } from '@/lib/apiAuthState';
import { ensureApiAuthSession } from '@/lib/axios';

/** Backup poll when socket push is healthy — compendium:updated drives refetches. */
const POLL_CONNECTED_MS = 120_000;
const POLL_MS = 45_000;
const POLL_DEGRADED_MS = 15_000;
const POLL_SLOW_MS = 120_000;
const POLL_REBUILD_MS = 2_000;
const REFETCH_DEBOUNCE_MS = 1_000;

function isMongoDegraded(status?: CompendiumSyncStatus): boolean {
  const state = status?.mongoHealth?.state;
  return status?.mongoConnected === false
    || state === 'unavailable'
    || state === 'circuit-open'
    || state === 'degraded'
    || status?.storage === 'local';
}

async function refetchAllCompendium(queryClient: ReturnType<typeof useQueryClient>) {
  if (isApiAuthBlocked()) return;
  const ok = await ensureApiAuthSession();
  if (!ok) return;
  await queryClient.refetchQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (key[0] !== 'compendium') return false;
      const scope = key[1];
      return scope === 'monsters' || scope === 'items' || scope === 'spells' || scope === 'sources';
    },
    type: 'active',
  });
}

export function useCompendiumSyncPoll(enabled = true) {
  const queryClient = useQueryClient();
  const lastSyncAt = useCompendiumUiStore((s) => s.lastSyncAt);
  const setLastSyncAt = useCompendiumUiStore((s) => s.setLastSyncAt);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pollMs, setPollMs] = useState(POLL_MS);
  const [socketConnected, setSocketConnected] = useState(() => getSocket().connected);

  const scheduleRefetch = () => {
    const status = queryClient.getQueryData<CompendiumSyncStatus>(['compendium', 'sync-status']);
    if (status?.catalogRebuild?.active) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refetchAllCompendium(queryClient);
    }, REFETCH_DEBOUNCE_MS);
  };

  const { data, isError } = useQuery({
    queryKey: ['compendium', 'sync-status'],
    queryFn: fetchSyncStatus,
    enabled,
    staleTime: 15_000,
    refetchInterval: (query) => {
      if (!enabled) return false;
      if (query.state.data?.catalogRebuild?.active) return POLL_REBUILD_MS;
      if (isMongoDegraded(query.state.data)) return POLL_DEGRADED_MS;
      return socketConnected ? POLL_CONNECTED_MS : pollMs;
    },
    refetchOnWindowFocus: !socketConnected,
    retry: 1,
  });

  useEffect(() => {
    if (!enabled) return;
    if (isError || isMongoDegraded(data)) {
      setPollMs(POLL_DEGRADED_MS);
    } else if (data?.mongoConnected) {
      setPollMs(POLL_MS);
    } else {
      setPollMs(POLL_SLOW_MS);
    }
  }, [enabled, isError, data]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onUpdated = (payload: { lastUpdated: string }) => {
      setLastSyncAt(payload.lastUpdated);
      scheduleRefetch();
    };

    const onCatalogRebuild = (payload: CatalogRebuildProgress) => {
      queryClient.setQueryData<CompendiumSyncStatus>(['compendium', 'sync-status'], (old) => {
        if (!old) return old;
        if (payload.active) return { ...old, catalogRebuild: payload };
        const { catalogRebuild: _removed, ...rest } = old;
        return rest;
      });
      if (!payload.active) {
        void refetchAllCompendium(queryClient);
      }
    };

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    const attach = () => {
      socket.off('compendium:updated', onUpdated);
      socket.on('compendium:updated', onUpdated);
      socket.off('compendium:catalog-rebuild', onCatalogRebuild);
      socket.on('compendium:catalog-rebuild', onCatalogRebuild);
    };

    setSocketConnected(socket.connected);
    attach();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', attach);

    return () => {
      socket.off('compendium:updated', onUpdated);
      socket.off('compendium:catalog-rebuild', onCatalogRebuild);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect', attach);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [enabled, queryClient, setLastSyncAt]);

  useEffect(() => {
    if (!data?.lastUpdated) return;
    if (lastSyncAt && data.lastUpdated !== lastSyncAt) {
      scheduleRefetch();
    }
    setLastSyncAt(data.lastUpdated);
  }, [data?.lastUpdated, lastSyncAt, setLastSyncAt]);

  return data;
}
