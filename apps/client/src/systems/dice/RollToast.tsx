import { useEffect } from 'react';
import { isMobileClient } from '@/lib/socket';
import { useDiceStore } from './diceStore';
import { formatRollBreakdown } from './diceAnimation';

/** Brief roll result toast (visible after stat-block / compendium rolls). */
export function RollToast() {
  const lastToast = useDiceStore((s) => s.lastToast);
  const clearToast = useDiceStore((s) => s.clearToast);

  useEffect(() => {
    if (!lastToast) return;
    const t = window.setTimeout(clearToast, 9000);
    return () => window.clearTimeout(t);
  }, [lastToast, clearToast]);

  if (!lastToast) return null;

  const GOLD = 'var(--color-accent-gold)';
  const mobile = isMobileClient();
  const toastClass = mobile
    ? 'fixed bottom-40 left-1/2 -translate-x-1/2 z-[100] rounded-lg px-4 py-2 shadow-2xl pointer-events-none max-w-[min(100vw-2rem,24rem)]'
    : 'fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] rounded-lg px-4 py-2 shadow-2xl pointer-events-none';

  if (lastToast.secretHidden) {
    return (
      <div
        className={toastClass}
        style={{
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
        }}
      >
        <div className="font-ui text-xs text-center" style={{ color: 'var(--color-text-secondary)' }}>
          {lastToast.rollerName} rolled secretly 🔒
        </div>
      </div>
    );
  }

  return (
    <div
      className={toastClass}
      style={{
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${lastToast.isCrit ? GOLD : lastToast.isCritFail ? '#ef4444' : 'var(--color-border)'}`,
      }}
    >
      <div className="font-ui text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        {lastToast.rollerName} · {lastToast.label}
      </div>
      <div
        className="font-display text-lg font-bold text-center"
        style={{ color: lastToast.isCrit ? GOLD : lastToast.isCritFail ? '#ef4444' : 'var(--color-text-primary)' }}
      >
        {lastToast.total}
        {lastToast.isCrit && ' ★'}
        {lastToast.isCritFail && ' ✗'}
      </div>
      <div className="font-ui text-xs text-center" style={{ color: 'var(--color-text-secondary)' }}>
        {formatRollBreakdown(lastToast)}
      </div>
    </div>
  );
}
