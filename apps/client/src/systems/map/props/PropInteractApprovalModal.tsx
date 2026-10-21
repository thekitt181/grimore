import { useMemo } from 'react';
import { useItemStore } from '@/systems/scene/store/itemStore';
import { useSessionStore } from '@/store/sessionStore';
import {
  propInteractCheckHint,
  resolvePropInteractRequest,
} from './fpPropInteract';
import { usePropInteractRequestStore } from './propInteractRequestStore';

/** GM approval for FP prop use; players see a short waiting line. */
export function PropInteractApprovalModal() {
  const gmPending = usePropInteractRequestStore((s) => s.gmPending);
  const playerWaiting = usePropInteractRequestStore((s) => s.playerWaiting);
  const clearPlayer = usePropInteractRequestStore((s) => s.clearPlayerWaiting);
  const isGm = useSessionStore((s) => s.myRole === 'GM');

  const propItem = useItemStore((s) =>
    gmPending ? s.items[gmPending.propItemId] : undefined,
  );

  const checkHint = useMemo(() => {
    if (propItem?.type !== 'image') return null;
    return propInteractCheckHint(propItem);
  }, [propItem]);

  if (!gmPending && !playerWaiting) return null;

  if (!isGm && playerWaiting) {
    return (
      <div
        className="fixed bottom-24 left-1/2 z-[210] -translate-x-1/2 rounded-lg shadow-panel px-3 py-2 max-w-[min(92vw,26rem)]"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <p className="font-ui text-xs" style={{ color: 'var(--color-text-primary)' }}>
          Waiting for DM to approve using{' '}
          <span style={{ color: 'var(--color-accent-gold)' }}>{playerWaiting.propName}</span>
          {' '}(E)
        </p>
        <button
          type="button"
          className="btn-ghost text-[10px] mt-1 px-2 py-0.5"
          onClick={() => clearPlayer(playerWaiting.requestId)}
        >
          Cancel
        </button>
      </div>
    );
  }

  if (!isGm || !gmPending) return null;

  const { requestId, requesterName, propName } = gmPending;

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center p-4"
      style={{ background: 'rgba(8,8,12,0.55)' }}
      role="dialog"
      aria-labelledby="prop-interact-title"
    >
      <div
        className="rounded-lg shadow-panel w-full max-w-md p-4 flex flex-col gap-3"
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border-gold)',
        }}
      >
        <h2 id="prop-interact-title" className="font-display text-base tracking-wide" style={{ color: 'var(--color-accent-gold)' }}>
          Use prop?
        </h2>
        <p className="font-ui text-sm" style={{ color: 'var(--color-text-primary)' }}>
          <span style={{ color: 'var(--color-accent-gold)' }}>{requesterName}</span>
          {' '}wants to use{' '}
          <span className="font-semibold">{propName}</span>
          {checkHint ? (
            <span className="block mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Configured check: {checkHint}
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            className="btn-ghost text-xs px-3 py-1"
            onClick={() => {
              void resolvePropInteractRequest(requestId, 'deny');
            }}
          >
            Deny
          </button>
          {checkHint && (
            <>
              <button
                type="button"
                className="btn-ghost text-xs px-3 py-1"
                onClick={() => {
                  void resolvePropInteractRequest(requestId, 'roll-ddb');
                }}
              >
                Wait for DDB roll
              </button>
              <button
                type="button"
                className="btn-ghost text-xs px-3 py-1"
                onClick={() => {
                  void resolvePropInteractRequest(requestId, 'roll-vtt');
                }}
              >
                Roll in VTT
              </button>
            </>
          )}
          <button
            type="button"
            className="btn-primary text-xs px-3 py-1"
            onClick={() => {
              void resolvePropInteractRequest(requestId, 'use');
            }}
          >
            {checkHint ? 'Use without roll' : 'Allow'}
          </button>
        </div>
        <button
          type="button"
          className="btn-ghost text-[10px] self-end"
          onClick={() => {
            void resolvePropInteractRequest(requestId, 'deny');
          }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
