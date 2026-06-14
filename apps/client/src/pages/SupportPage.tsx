import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { AppShell } from '@/components/layout/AppShell';
import {
  fetchSupportConfig,
  fetchSupportStatus,
  formatSupportAmount,
  openSupportPortal,
  startSupportCheckout,
} from '@/lib/supportApi';

export function SupportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [loading, setLoading] = useState<'payment' | 'subscription' | 'portal' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const thanks = searchParams.get('thanks') === '1';
  const canceled = searchParams.get('canceled') === '1';

  const { data: config, isLoading: configLoading } = useQuery({
    queryKey: ['support', 'config'],
    queryFn: fetchSupportConfig,
  });

  const { data: status, isLoading: statusLoading } = useQuery({
    queryKey: ['support', 'status'],
    queryFn: fetchSupportStatus,
  });

  async function goCheckout(mode: 'payment' | 'subscription') {
    setError(null);
    setLoading(mode === 'payment' ? 'payment' : 'subscription');
    try {
      const url = await startSupportCheckout(mode);
      window.location.href = url;
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { error?: string } | undefined)?.error ?? err.message
        : err instanceof Error ? err.message : 'Checkout failed';
      setError(msg);
      setLoading(null);
    }
  }

  async function goPortal() {
    setError(null);
    setLoading('portal');
    try {
      const url = await openSupportPortal();
      window.location.href = url;
    } catch {
      setError('Could not open billing portal');
      setLoading(null);
    }
  }

  function dismissBanner() {
    searchParams.delete('thanks');
    searchParams.delete('canceled');
    searchParams.delete('session_id');
    setSearchParams(searchParams, { replace: true });
    void queryClient.invalidateQueries({ queryKey: ['support', 'status'] });
  }

  const oneTimeLabel = config
    ? formatSupportAmount(config.oneTimeAmountCents, config.currency)
    : '$5.00';

  return (
    <AppShell>
      <div className="flex-1 p-6 md:p-10 max-w-2xl mx-auto w-full">
        <div className="mb-8">
          <p className="font-ui text-sm mb-1" style={{ color: 'var(--color-text-secondary)' }}>
            Grimoire VTT
          </p>
          <h1
            className="font-display text-3xl font-bold tracking-wide"
            style={{ color: 'var(--color-accent-gold)' }}
          >
            Support the developer
          </h1>
          <p className="font-body text-base mt-3" style={{ color: 'var(--color-text-secondary)' }}>
            Grimoire is built and hosted by an indie developer. One-time tips and monthly support
            help cover hosting, DDB integration work, and new features — thank you.
          </p>
        </div>

        {thanks && (
          <div
            className="mb-6 rounded-lg px-4 py-3 flex items-start justify-between gap-3"
            style={{ background: 'rgba(74, 222, 128, 0.12)', border: '1px solid rgba(74, 222, 128, 0.35)' }}
          >
            <p className="font-ui text-sm" style={{ color: '#86efac' }}>
              Thank you for your support. It means a lot.
            </p>
            <button type="button" className="btn-ghost text-xs py-1 px-2" onClick={dismissBanner}>
              Dismiss
            </button>
          </div>
        )}

        {canceled && !thanks && (
          <div
            className="mb-6 rounded-lg px-4 py-3 flex items-start justify-between gap-3"
            style={{ background: 'rgba(201, 168, 76, 0.1)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Checkout was canceled — no charge was made.
            </p>
            <button type="button" className="btn-ghost text-xs py-1 px-2" onClick={dismissBanner}>
              Dismiss
            </button>
          </div>
        )}

        {status?.supporterActive && (
          <div
            className="mb-6 rounded-lg px-4 py-3"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-ui text-sm font-semibold" style={{ color: 'var(--color-accent-gold)' }}>
              You are a supporter
              {status.supporterPlan === 'monthly' ? ' (monthly)' : status.supporterPlan === 'one_time' ? ' (one-time)' : ''}
            </p>
            {status.supporterSince && (
              <p className="font-ui text-xs mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Since {new Date(status.supporterSince).toLocaleDateString()}
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mb-4 font-ui text-sm" style={{ color: 'var(--color-accent-red-hot)' }}>
            {error}
          </p>
        )}

        {configLoading || statusLoading ? (
          <p className="font-ui text-sm animate-torch" style={{ color: 'var(--color-text-secondary)' }}>
            Loading…
          </p>
        ) : !config?.enabled ? (
          <div
            className="rounded-lg p-6"
            style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
          >
            <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Support payments are not set up on this server yet. The developer can enable Stripe
              with <code className="text-xs">STRIPE_SECRET_KEY</code> and price IDs in the server environment.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {config.oneTime && (
              <div
                className="rounded-lg p-5 flex flex-col gap-4"
                style={{ background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)' }}
              >
                <div>
                  <h2 className="font-display text-lg tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
                    One-time tip
                  </h2>
                  <p className="font-ui text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    Send a single thank-you — no recurring charge.
                  </p>
                  <p className="font-display text-2xl mt-3" style={{ color: 'var(--color-accent-gold)' }}>
                    {oneTimeLabel}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary w-full mt-auto"
                  disabled={loading !== null}
                  onClick={() => void goCheckout('payment')}
                >
                  {loading === 'payment' ? 'Redirecting…' : 'Tip once'}
                </button>
              </div>
            )}

            {config.monthly && (
              <div
                className="rounded-lg p-5 flex flex-col gap-4"
                style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid rgba(201, 168, 76, 0.35)',
                }}
              >
                <div>
                  <h2 className="font-display text-lg tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
                    Monthly support
                  </h2>
                  <p className="font-ui text-sm mt-2" style={{ color: 'var(--color-text-secondary)' }}>
                    Subscribe to help keep Grimoire running every month. Cancel anytime.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-primary w-full mt-auto"
                  disabled={loading !== null}
                  onClick={() => void goCheckout('subscription')}
                >
                  {loading === 'subscription' ? 'Redirecting…' : 'Subscribe monthly'}
                </button>
              </div>
            )}
          </div>
        )}

        {status?.hasSubscription && config?.enabled && (
          <div className="mt-6 pt-6" style={{ borderTop: '1px solid var(--color-border)' }}>
            <button
              type="button"
              className="btn-ghost"
              disabled={loading !== null}
              onClick={() => void goPortal()}
            >
              {loading === 'portal' ? 'Opening…' : 'Manage or cancel subscription'}
            </button>
          </div>
        )}

        <p className="font-ui text-xs mt-8" style={{ color: 'var(--color-text-secondary)' }}>
          Payments are processed securely by Stripe. Grimoire does not store card numbers.
        </p>
      </div>
    </AppShell>
  );
}
