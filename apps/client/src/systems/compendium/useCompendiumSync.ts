import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchSyncStatus } from './compendiumApi';
import { useCompendiumUiStore } from './compendiumStore';
import { getSocket } from '@/lib/socket';

const POLL_MS = 12_000;
const POLL_SLOW_MS = 45_000;

function refetchAllCompendium(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (key[0] !== 'compendium') return false;
      const scope = key[1];
      return scope === 'monsters' || scope === 'items' || scope === 'spells' || scope === 'sources';
    },
    refetchType: 'active',
  });
}

export function useCompendiumSyncPoll(enabled = true) {
  const queryClient = useQueryClient();
  const lastSyncAt = useCompendiumUiStore((s) => s.lastSyncAt);
  const setLastSyncAt = useCompendiumUiStore((s) => s.setLastSyncAt);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pollMs, setPollMs] = useState(POLL_MS);

  const scheduleRefetch = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      refetchAllCompendium(queryClient);
    }, 150);
  };

  const { data, isError } = useQuery({
    queryKey: ['compendium', 'sync-status'],
    queryFn: fetchSyncStatus,
    enabled,
    staleTime: 5_000,
    refetchInterval: enabled ? pollMs : false,
    refetchOnWindowFocus: true,
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

    const attach = () => {
      socket.on('compendium:updated', onUpdated);
    };

    if (socket.connected) attach();
    socket.on('connect', attach);

    return () => {
      socket.off('compendium:updated', onUpdated);
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
