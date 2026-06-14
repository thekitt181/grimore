import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { authClient } from '@/lib/auth-client';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const tokenError = searchParams.get('error');

  const invalidToken = useMemo(() => {
    if (tokenError) return true;
    return !token;
  }, [token, tokenError]);

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!token) return;

    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      const { error: resetError } = await authClient.resetPassword({
        newPassword: password,
        token,
      });
      if (resetError) {
        setError(resetError.message ?? 'Could not reset password');
        return;
      }
      navigate('/sign-in', { replace: true, state: { passwordReset: true } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reset password');
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
          <div className="text-5xl mb-3">🎲</div>
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
            Choose a new password
          </h2>

          {invalidToken ? (
            <div className="space-y-4">
              <p className="text-sm rounded px-3 py-2" style={{ background: '#3a1515', color: '#ffb4b4' }}>
                This reset link is invalid or has expired.
              </p>
              <p className="text-center font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <Link to="/forgot-password" style={{ color: 'var(--color-accent-gold)' }}>
                  Request a new reset link
                </Link>
              </p>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="space-y-4">
              {error && (
                <p className="text-sm rounded px-3 py-2" style={{ background: '#3a1515', color: '#ffb4b4' }}>
                  {error}
                </p>
              )}

              <label className="block space-y-1">
                <span className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  New password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded px-3 py-2 font-ui text-sm border"
                  style={{
                    background: 'var(--color-bg-primary)',
                    borderColor: 'var(--color-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
              </label>

              <label className="block space-y-1">
                <span className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  Confirm password
                </span>
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
