import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DraggablePanel } from '@/components/DraggablePanel';
import {
  fetchDdbStatus,
  linkDdbAccount,
  unlinkDdbAccount,
  updateDdbSettings,
} from './ddbApi';
import { useDdbStore } from './ddbStore';

const GOLD = 'var(--color-accent-gold)';
const BD = 'var(--color-border)';

function DdbLinkPanelBody() {
  const qc = useQueryClient();
  const [cobalt, setCobalt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ['ddb', 'status'],
    queryFn: fetchDdbStatus,
    staleTime: 30_000,
  });

  const linkMutation = useMutation({
    mutationFn: () => linkDdbAccount(cobalt.trim()),
    onSuccess: () => {
      setCobalt('');
      setError(null);
      void qc.invalidateQueries({ queryKey: ['ddb'] });
    },
    onError: (err: Error) => setError(err.message),
  });

  const unlinkMutation = useMutation({
    mutationFn: unlinkDdbAccount,
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['ddb'] }),
  });

  const settingsMutation = useMutation({
    mutationFn: updateDdbSettings,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ddb', 'status'] });
      useDdbStore.getState().bumpRollBridge();
    },
  });

  return (
    <>
      <p className="font-ui text-[11px] mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Powered by D&D Beyond. Link your account with a Cobalt session token — see{' '}
        <span style={{ color: GOLD }}>docs/DDB_SETUP.md</span>.
      </p>

      {isLoading ? (
        <p className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>Checking link…</p>
      ) : status?.linked ? (
        <div className="space-y-3">
          <div
            className="rounded px-3 py-2 font-ui text-xs"
            style={{
              background: status.valid ? 'rgba(74,222,128,0.1)' : 'rgba(248,113,113,0.1)',
              border: `1px solid ${status.valid ? '#4ade80' : '#f87171'}`,
            }}
          >
            {status.valid ? '✓ Connected' : '⚠ Session expired — re-link required'}
            {status.lastValidatedAt && (
              <span className="block mt-1 opacity-70">
                Last validated: {new Date(status.lastValidatedAt).toLocaleString()}
              </span>
            )}
          </div>

          <label className="flex items-center gap-2 font-ui text-xs cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={status.syncHpToDdb ?? true}
              onChange={(e) => settingsMutation.mutate({ syncHpToDdb: e.target.checked })}
            />
            Push HP changes to D&D Beyond
          </label>
          <label className="flex items-center gap-2 font-ui text-xs cursor-pointer">
            <input
              type="checkbox"
              defaultChecked={status.rollBridgeEnabled ?? false}
              onChange={(e) => settingsMutation.mutate({ rollBridgeEnabled: e.target.checked })}
            />
            Enable roll bridge (DDB game log → dice tray)
          </label>

          <button
            type="button"
            className="btn-ghost text-xs w-full"
            disabled={unlinkMutation.isPending}
            onClick={() => unlinkMutation.mutate()}
          >
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="font-ui text-xs block" style={{ color: 'var(--color-text-secondary)' }}>
            Cobalt session token
          </label>
          <input
            type="password"
            className="w-full rounded px-2 py-1.5 font-mono text-xs"
            style={{ background: 'var(--color-bg-primary)', border: `1px solid ${BD}` }}
            placeholder="Paste CobaltSession cookie value"
            value={cobalt}
            onChange={(e) => setCobalt(e.target.value)}
          />
          {error && (
            <p className="font-ui text-[11px]" style={{ color: 'var(--color-accent-red-hot)' }}>{error}</p>
          )}
          <button
            type="button"
            className="btn-primary w-full text-sm"
            disabled={!cobalt.trim() || linkMutation.isPending}
            onClick={() => linkMutation.mutate()}
          >
            {linkMutation.isPending ? 'Linking…' : 'Link account'}
          </button>
        </div>
      )}
    </>
  );
}

/** Floating draggable panel (session map). */
export function DdbLinkPanel({ onClose }: { onClose: () => void }) {
  return (
    <DraggablePanel
      title="D&D Beyond"
      subtitle="Account link"
      onClose={onClose}
      defaultPosition={{ x: Math.max(16, (window.innerWidth - 400) / 2), y: 100 }}
      width={400}
      maxHeight="75vh"
      zIndex={140}
      footer="Powered by D&D Beyond"
    >
      <div className="p-4">
        <DdbLinkPanelBody />
      </div>
    </DraggablePanel>
  );
}

/** Inline embed (campaign settings page). */
export function DdbLinkPanelEmbedded() {
  return (
    <div
      className="rounded-lg shadow-panel p-4 max-w-md w-full"
      style={{ background: 'var(--color-bg-secondary)', border: `1px solid ${BD}` }}
    >
      <h3 className="font-display text-sm tracking-wider mb-3" style={{ color: GOLD }}>
        D&D Beyond
      </h3>
      <DdbLinkPanelBody />
    </div>
  );
}
