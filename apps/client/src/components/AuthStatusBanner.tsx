import { useEffect, useState } from 'react';
import { useAuth, useClerk } from '@clerk/clerk-react';
import { getApiAuthBlockReason, isClerkDevKeyOnPublicSite } from '@/lib/apiAuthState';
import { isApiAuthBlocked } from '@/lib/apiAuthState';
import { ensureApiAuthSession } from '@/lib/axios';

export function AuthStatusBanner() {
  const { isLoaded, isSignedIn } = useAuth();
  const { signOut } = useClerk();
  const [blocked, setBlocked] = useState(false);
  const [checking, setChecking] = useState(false);
  const devKeyWarning = isClerkDevKeyOnPublicSite();

  useEffect(() => {
    const sync = () => setBlocked(isApiAuthBlocked());
    sync();
    window.addEventListener('grimoire:auth-expired', sync);
    window.addEventListener('grimoire:auth-recovered', sync);
    return () => {
      window.removeEventListener('grimoire:auth-expired', sync);
      window.removeEventListener('grimoire:auth-recovered', sync);
    };
  }, []);

  if (!isLoaded || !isSignedIn) return null;
  if (!blocked && !devKeyWarning) return null;

  async function retryAuth() {
    setChecking(true);
    try {
      await ensureApiAuthSession(true);
      setBlocked(isApiAuthBlocked());
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="font-ui text-xs px-4 py-2 shrink-0 leading-snug"
      style={{
        background: 'rgba(127,29,29,0.35)',
        borderBottom: '1px solid rgba(248,113,113,0.35)',
        color: '#fecaca',
      }}
    >
      {devKeyWarning && (
        <p className="mb-1">
          Clerk development keys are active on a public site. On Render, set matching{' '}
          <code>VITE_CLERK_PUBLISHABLE_KEY</code> (client build) and{' '}
          <code>CLERK_SECRET_KEY</code> (server) from the same Clerk app, then add{' '}
          <code>{typeof window !== 'undefined' ? window.location.origin : ''}</code> in Clerk → Domains.
        </p>
      )}
      {blocked && (
        <p>
          The API rejected your sign-in token
          {getApiAuthBlockReason() === 'unauthorized' ? ' (401 Unauthorized)' : ''}.
          Sign out and back in, or verify Render <code>CLERK_SECRET_KEY</code> matches your publishable key.
        </p>
      )}
      <div className="flex gap-2 mt-1.5 flex-wrap">
        <button
          type="button"
          className="btn-ghost text-[11px] py-0.5 px-2"
          disabled={checking}
          onClick={() => void retryAuth()}
        >
          {checking ? 'Checking…' : 'Retry sign-in'}
        </button>
        <button
          type="button"
          className="btn-ghost text-[11px] py-0.5 px-2"
          onClick={() => void signOut({ redirectUrl: '/sign-in' })}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
