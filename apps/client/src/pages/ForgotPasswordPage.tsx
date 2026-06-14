import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';
import { getPublicAppUrl } from '@/lib/appUrls';
import { LogoMark } from '@/components/LogoMark';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const redirectTo = `${getPublicAppUrl()}/reset-password`;
      const { error: resetError } = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo,
      });
      if (resetError) {
        setError(resetError.message ?? 'Could not send reset email');
        return;
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send reset email');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'var(--color-bg-primary)' }}
    >
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-3">
            <LogoMark size={56} />
          </div>
          <h1
            className="font-display text-4xl font-black tracking-widest animate-torch"
            style={{ color: 'var(--color-accent-gold)' }}
          >
            GRIMOIRE
          </h1>
          <p className="font-body text-base mt-1" style={{ color: 'var(--color-text-secondary)' }}>
            Dark Fantasy Virtual Tabletop
          </p>
        </div>

        <div
          className="rounded-lg border p-6 space-y-4"
          style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}
        >
          <h2 className="font-display text-xl" style={{ color: 'var(--color-text-primary)' }}>
            Reset password
          </h2>

          {sent ? (
            <div className="space-y-4">
              <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                If an account exists for <strong style={{ color: 'var(--color-text-primary)' }}>{email}</strong>,
                we sent a reset link. Check your inbox and spam folder.
              </p>
              <p className="text-center font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <Link to="/sign-in" style={{ color: 'var(--color-accent-gold)' }}>
                  Back to sign in
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              <p className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Enter your email and we&apos;ll send you a link to choose a new password.
              </p>

              {error && (
                <p className="text-sm rounded px-3 py-2" style={{ background: '#3a1515', color: '#ffb4b4' }}>
                  {error}
                </p>
              )}

              <label className="block space-y-1">
                <span className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Email
                </span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded px-3 py-2 font-ui text-sm border"
                  style={{
                    background: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </label>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded py-2 font-ui text-sm font-semibold disabled:opacity-60"
                style={{ background: 'var(--color-accent-gold)', color: '#1a1208' }}
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>

              <p className="text-center font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <Link to="/sign-in" style={{ color: 'var(--color-accent-gold)' }}>
                  Back to sign in
                </Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
