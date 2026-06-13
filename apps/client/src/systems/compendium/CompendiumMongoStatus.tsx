import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CompendiumSyncStatus } from '@grimoire/shared';
import { extractApiError } from '@/lib/apiError';
import { fetchSyncStatus, reconcileCompendiumMongo } from './compendiumApi';

const GOLD = 'var(--color-accent-gold)';

function mongoStatusLabel(status?: CompendiumSyncStatus): { text: string; tone: 'ok' | 'warn' | 'bad' | 'off' } {
  const health = status?.mongoHealth;
  if (!health?.configured) {
    return { text: 'Mongo off (local)', tone: 'off' };
  }
  switch (health.state) {
    case 'connected':
      return {
        text: health.latencyMs != null ? `Mongo OK · ${health.latencyMs}ms` : 'Mongo OK',
        tone: 'ok',
      };
    case 'degraded':
      return { text: 'Mongo degraded', tone: 'warn' };
    case 'circuit-open':
      return { text: 'Mongo paused (circuit)', tone: 'bad' };
    case 'unavailable':
      return { text: 'Mongo unreachable', tone: 'bad' };
    default:
      return { text: status?.storage === 'mongodb' ? 'Mongo syncing…' : 'Local fallback', tone: 'warn' };
  }
}

function toneColor(tone: 'ok' | 'warn' | 'bad' | 'off'): string {
  if (tone === 'ok') return '#4ade80';
  if (tone === 'warn') return '#fbbf24';
  if (tone === 'bad') return 'var(--color-accent-red-hot)';
  return 'var(--color-text-secondary)';
}

function needsMongoHeal(status?: CompendiumSyncStatus): boolean {
  if (!status?.mongoHealth?.configured) return false;
  const state = status.mongoHealth.state;
  return status.mongoConnected === false
    || state === 'unavailable'
    || state === 'circuit-open'
    || state === 'degraded'
    || status.storage === 'local';
}

export function CompendiumMongoStatus() {
  const qc = useQueryClient();
  const [healMessage, setHealMessage] = useState<string | null>(null);
  const { data: syncStatus } = useQuery({
    queryKey: ['compendium', 'sync-status'],
    queryFn: fetchSyncStatus,
    staleTime: 15_000,
  });
  const label = mongoStatusLabel(syncStatus);
  const showHeal = needsMongoHeal(syncStatus);

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
        setHealMessage('Mongo restored — catalog rebuilding in background.');
      } else {
        setHealMessage(
          next.mongoHealth?.lastError
            ?? 'Mongo still unavailable — local compendium refreshed; check Atlas IP allowlist and network.',
        );
      }
    },
    onError: (err) => {
      setHealMessage(extractApiError(err, 'Heal failed — Mongo still unavailable'));
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
            title="Reset Mongo circuit breaker, reconnect, and sync compendium"
          >
            {healMut.isPending ? 'Healing…' : 'Heal'}
          </button>
        )}
      </div>
      {healMessage && (
        <p
          className="font-ui text-[10px] leading-snug px-0.5"
          style={{
            color: healMessage.startsWith('Mongo restored')
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
