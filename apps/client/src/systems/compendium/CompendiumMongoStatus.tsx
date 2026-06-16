import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompendiumSyncStatus } from '@grimoire/shared';
import { extractApiError } from '@/lib/apiError';
import { fetchSyncStatus, reconcileCompendiumMongo } from './compendiumApi';

const GOLD = 'var(--color-accent-gold)';

function compendiumBackendLabel(status?: CompendiumSyncStatus): string {
  if (status?.storage === 'postgresql') return 'Postgres';
  if (status?.mongoHealth?.configured) return 'Mongo';
  return 'Local';
}

function compendiumStatusLabel(status?: CompendiumSyncStatus): { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' } {
  const health = status?.mongoHealth;
  const storage = status?.storage;
  const backend = compendiumBackendLabel(status);

  if (!health?.configured && storage !== 'postgresql') {
    return { text: 'Compendium off (local files)', tone: 'off' };
  }

  switch (health?.state) {
    case 'connected':
      return {
        text: health.latencyMs != null ? `${backend} OK · ${health.latencyMs}ms` : `${backend} OK`,
        tone: 'ok',
      };
    case 'degraded':
      return { text: `${backend} degraded`, tone: 'warn' };
    case 'circuit-open':
      return { text: `${backend} paused (circuit)`, tone: 'bad' };
    case 'unavailable':
      return {
        text: storage === 'postgresql' ? 'Compendium DB busy' : `${backend} unreachable`,
        tone: 'warn',
      };
    default:
      return {
        text: storage === 'postgresql' ? 'Postgres syncing…' : 'Local fallback',
        tone: 'warn',
      };
  }
}

function toneColor(tone: 'ok' | 'warn' | 'bad' | 'off'): string {
  if (tone === 'ok') return '#4ade80';
  if (tone === 'warn') return '#fbbf24';
  if (tone === 'bad') return 'var(--color-accent-red-hot)';
  return 'var(--color-text-secondary)';
}

function needsCompendiumHeal(status?: CompendiumSyncStatus): boolean {
  const state = status?.mongoHealth?.state;
  return status?.mongoConnected === false
    || state === 'unavailable'
    || state === 'circuit-open'
    || state === 'degraded'
    || status?.storage === 'local';
}

export function CompendiumMongoStatus() {
  const qc = useQueryClient();
  const [healMessage, setHealMessage] = useState<string | null>(null);
  const { data: syncStatus } = useQuery({
    queryKey: ['compendium', 'sync-status'],
    queryFn: fetchSyncStatus,
    staleTime: 15_000,
  });
  const label = compendiumStatusLabel(syncStatus);
  const showHeal = needsCompendiumHeal(syncStatus);
  const backend = compendiumBackendLabel(syncStatus);

  const healMut = useMutation({
    mutationFn: () =>
      reconcileCompendiumMongo({
        reason: 'compendium-ui-heal',
        deferCatalogRebuild: true,
        strict: false,
      }),
    onSuccess: (next) => {
      qc.setQueryData(['compendium', 'sync-status'], next);
      void qc.invalidateQueries({ queryKey: ['compendium'] });
      if (next.mongoHealth?.state === 'connected') {
        setHealMessage(`${backend} restored — catalog rebuilding in background.`);
      } else {
        setHealMessage(
          next.mongoHealth?.lastError
            ?? `${backend} still unavailable — local compendium refreshed.`,
        );
      }
    },
    onError: (err) => {
      setHealMessage(extractApiError(err, 'Heal failed — compendium DB still unavailable'));
      void qc.invalidateQueries({ queryKey: ['compendium', 'sync-status'] });
    },
  });

  const statusTitle = syncStatus?.mongoHealth?.lastError
    ?? (syncStatus?.mongoHealth?.lastCheckedAt
      ? `Last checked ${new Date(syncStatus.mongoHealth.lastCheckedAt).toLocaleTimeString()}`
      : undefined);

  return (
    <div className="space-y-0.5 shrink-0">
      <div
        className="flex items-center gap-1 rounded px-1 py-0.5"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid var(--color-border)',
        }}
        title={statusTitle}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: toneColor(label.tone) }}
        />
        <span className="font-ui text-[10px] truncate flex-1" style={{ color: toneColor(label.tone) }}>
          {label.text}
        </span>
        {showHeal && (
          <button
            type="button"
            className="font-ui text-[10px] shrink-0 px-1 rounded hover:opacity-80 disabled:opacity-40"
            style={{ color: GOLD }}
            disabled={healMut.isPending}
            onClick={() => {
              setHealMessage(null);
              healMut.mutate();
            }}
            title="Reset compendium DB circuit breaker and refresh catalog"
          >
            {healMut.isPending ? 'Healing…' : 'Heal'}
          </button>
        )}
      </div>
      {healMessage && (
        <p
          className="font-ui text-[10px] leading-snug px-0.5"
          style={{
            color: healMessage.includes('restored')
              ? '#4ade80'
              : 'var(--color-accent-red-hot)',
          }}
        >
          {healMessage}
        </p>
      )}
    </div>
  );
}
