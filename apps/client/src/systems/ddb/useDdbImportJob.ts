import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import type { DdbLibraryImportJob } from '@grimoire/shared';
import {
  cancelDdbLibraryImportJob,
  fetchActiveDdbLibraryImportJob,
  fetchDdbLibraryImportJob,
  getStoredDdbImportJobId,
  setStoredDdbImportJobId,
  startDdbLibraryImportJob,
} from './ddbApi';
import { refetchCompendiumAfterImport } from '@/systems/compendium/compendiumLockCache';
import { useCompendiumUiStore } from '@/systems/compendium/compendiumStore';

export function useDdbImportJob(enabled = true) {
  const qc = useQueryClient();
  const storedJobId = getStoredDdbImportJobId();

  const jobQ = useQuery({
    queryKey: ['ddb', 'import-job', storedJobId ?? 'active'],
    queryFn: async () => {
      if (storedJobId) {
        const tracked = await fetchDdbLibraryImportJob(storedJobId);
        if (tracked) return tracked;
        setStoredDdbImportJobId(null);
      }
      return fetchActiveDdbLibraryImportJob();
    },
    enabled,
    refetchInterval: (query) => (query.state.data?.status === 'running' ? 2500 : false),
    staleTime: 1000,
    retry: (failureCount, error) => {
      if (axios.isAxiosError(error) && error.response?.status === 503) return failureCount < 3;
      return false;
    },
    retryDelay: (attempt) => Math.min(2000 * attempt, 8000),
  });

  const job = jobQ.data ?? null;
  const isRunning = job?.status === 'running';
  const handledCompleteRef = useRef<string | null>(null);

  useEffect(() => {
    if (!job) return;
    if (job.status === 'running') {
      setStoredDdbImportJobId(job.id);
      return;
    }
    setStoredDdbImportJobId(null);
    if (job.status === 'completed' && job.result && handledCompleteRef.current !== job.id) {
      handledCompleteRef.current = job.id;
      useCompendiumUiStore.getState().setBrowseMode('sources');
      useCompendiumUiStore.getState().setPanelOpen(true);
      void refetchCompendiumAfterImport(
        qc,
        job.result.catalogRev ? { catalogRev: job.result.catalogRev } : undefined,
      );
    }
  }, [job?.id, job?.status, job?.result, qc]);

  const startMut = useMutation({
    mutationFn: startDdbLibraryImportJob,
    onSuccess: (started) => {
      setStoredDdbImportJobId(started.id);
      void qc.invalidateQueries({ queryKey: ['ddb', 'import-job'] });
    },
  });

  const cancelMut = useMutation({
    mutationFn: (jobId: string) => cancelDdbLibraryImportJob(jobId),
    onSuccess: () => {
      setStoredDdbImportJobId(null);
      void qc.invalidateQueries({ queryKey: ['ddb', 'import-job'] });
    },
  });

  const verb: 'import' | 'reimport' = job?.skipExisting ? 'reimport' : 'import';

  const progressPercent = useMemo(() => {
    const progress = job?.progress;
    if (!progress) return null;
    const bookTotal = progress.bookTotal ?? 0;
    const bookIndex = progress.bookIndex ?? 0;
    if (bookTotal <= 0) return null;

    const phaseRange: Record<string, [number, number]> = {
      'listing-monsters': [0, 0.08],
      monsters: [0.08, 0.33],
      'listing-spells': [0.33, 0.38],
      spells: [0.38, 0.63],
      'listing-items': [0.63, 0.68],
      items: [0.68, 0.98],
      complete: [1, 1],
    };

    let within = 0;
    if (progress.phase === 'complete') {
      within = 1;
    } else {
      const [start, end] = phaseRange[progress.phase] ?? [0, 0.25];
      if (progress.total > 0) {
        within = start + (Math.min(progress.done, progress.total) / progress.total) * (end - start);
      } else {
        within = start;
      }
    }

    const completedBooks = Math.max(0, bookIndex - 1) + within;
    return Math.min(100, Math.round((completedBooks / bookTotal) * 100));
  }, [job?.progress]);

  return {
    job,
    isRunning,
    verb,
    progressPercent,
    startImport: startMut.mutateAsync,
    isStarting: startMut.isPending,
    cancelImport: (jobId: string) => cancelMut.mutateAsync(jobId),
    isCancelling: cancelMut.isPending,
    refreshJob: () => jobQ.refetch(),
  };
}

export type { DdbLibraryImportJob };
