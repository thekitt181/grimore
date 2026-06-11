import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSyncStatus } from './compendiumApi';
import { useCompendiumUiStore } from './compendiumStore';
import { getSocket } from '@/lib/socket';
import { isApiAuthBlocked } from '@/lib/apiAuthState';
import { ensureApiAuthSession } from '@/lib/axios';

/** Backup poll when socket push is healthy — compendium:updated drives refetches. */
const POLL_CONNECTED_MS = 120_000;
const POLL_MS = 45_000;
const POLL_SLOW_MS = 120_000;

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
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void refetchAllCompendium(queryClient);
    }, 150);
  };

  const { data, isError } = useQuery({
    queryKey: ['compendium', 'sync-status'],
    queryFn: fetchSyncStatus,
    enabled,
    staleTime: 15_000,
    refetchInterval: enabled ? (socketConnected ? POLL_CONNECTED_MS : pollMs) : false,
    refetchOnWindowFocus: !socketConnected,
    retry: 1,
  });

  useEffect(() => {
    if (!enabled) return;
    if (isError || data?.mongoConnected === false) {
      setPollMs(POLL_SLOW_MS);
    } else if (data?.mongoConnected) {
      setPollMs(POLL_MS);
    }
  }, [enabled, isError, data?.mongoConnected]);

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const onUpdated = (payload: { lastUpdated: string }) => {
      setLastSyncAt(payload.lastUpdated);
      scheduleRefetch();
    };

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);

    const attach = () => {
      socket.off('compendium:updated', onUpdated);
      socket.on('compendium:updated', onUpdated);
    };

    setSocketConnected(socket.connected);
    attach();
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect', attach);

    return () => {
      socket.off('compendium:updated', onUpdated);
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
