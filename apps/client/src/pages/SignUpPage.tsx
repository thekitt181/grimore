import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authClient, signInWithGoogle } from '@/lib/auth-client';
import { useGoogleOAuthAvailable } from '@/hooks/useGoogleOAuthAvailable';
import { LogoMark } from '@/components/LogoMark';

export function SignUpPage() {
  const navigate = useNavigate();
  const googleOAuthAvailable = useGoogleOAuthAvailable();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signUpError } = await authClient.signUp.email({
        name: name.trim() || email.split('@')[0] || 'Adventurer',
        email,
        password,
      });
      if (signUpError) {
        setError(signUpError.message ?? 'Sign up failed');
        return;
      }
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  }

  async function onGoogleSignUp() {
    setError(null);
    setGoogleLoading(true);
    try {
      const message = await signInWithGoogle();
      if (message) setError(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setGoogleLoading(false);
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

        <form
          onSubmit={onSubmit}
          className="rounded-lg border p-6 space-y-4"
          style={{ background: 'var(--color-bg-secondary)', borderColor: 'var(--color-border)' }}
        >
          <h2 className="font-display text-xl" style={{ color: 'var(--color-text-primary)' }}>
            Create account
          </h2>

          {error && (
            <p className="text-sm rounded px-3 py-2" style={{ background: '#3a1515', color: '#ffb4b4' }}>
              {error}
            </p>
          )}

          <label className="block space-y-1">
            <span className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Display name
            </span>
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
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

          <label className="block space-y-1">
            <span className="font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Password
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

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded py-2 font-ui text-sm font-semibold disabled:opacity-60"
            style={{ background: 'var(--color-accent-gold)', color: '#1a1208' }}
          >
            {loading ? 'Creating account…' : 'Sign up'}
          </button>

          {googleOAuthAvailable === true && (
            <button
              type="button"
              disabled={googleLoading || loading}
              onClick={() => void onGoogleSignUp()}
              className="w-full rounded py-2 font-ui text-sm border disabled:opacity-60"
              style={{
                borderColor: 'var(--color-border)',
                color: 'var(--color-text-primary)',
                background: 'transparent',
              }}
            >
              {googleLoading ? 'Redirecting to Google…' : 'Continue with Google'}
            </button>
          )}

          <p className="text-center font-ui text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Already have an account?{' '}
            <Link to="/sign-in" style={{ color: 'var(--color-accent-gold)' }}>
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
}
