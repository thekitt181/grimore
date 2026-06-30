import { useEffect, useLayoutEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useGrimoireAuth } from '@/hooks/useGrimoireAuth';
import { getAuthBearerToken, signOutAndClear } from '@/lib/auth-client';
import { hydrateSessionAfterOAuth } from '@/lib/oauthHelpers';
import { setAuthTokenGetter, verifyApiSessionState } from '@/lib/axios';
import { Dashboard } from '@/pages/Dashboard';
import { CampaignDetail } from '@/pages/CampaignDetail';
import { SessionPage } from '@/pages/SessionPage';
import { JoinPage } from '@/pages/JoinPage';
import { SupportPage } from '@/pages/SupportPage';
import { SignInPage } from '@/pages/SignInPage';
import { SignUpPage } from '@/pages/SignUpPage';
import { ForgotPasswordPage } from '@/pages/ForgotPasswordPage';
import { ResetPasswordPage } from '@/pages/ResetPasswordPage';
import { DdbImportJobBanner } from '@/systems/ddb/DdbImportJobBanner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useGrimoireAuth();
  const [apiReady, setApiReady] = useState(false);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [serverWaking, setServerWaking] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setApiReady(false);
      setSessionInvalid(false);
      setServerWaking(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      await getAuthBearerToken({ skipCache: true });
      for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
        const state = await verifyApiSessionState(true);
        if (cancelled) return;
        if (state === 'ok') {
          setApiReady(true);
          setServerWaking(false);
          return;
        }
        if (state === 'unauthorized') {
          await signOutAndClear();
          setSessionInvalid(true);
          setApiReady(false);
          setServerWaking(false);
          return;
        }
        if (attempt >= 3) {
          setApiReady(true);
          setServerWaking(true);
        }
        await new Promise((r) => setTimeout(r, Math.min(1500 * (attempt + 1), 6000)));
      }
      if (!cancelled) {
        setApiReady(true);
        setServerWaking(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !serverWaking) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      const state = await verifyApiSessionState(true);
      if (cancelled) return;
      if (state === 'ok') {
        setServerWaking(false);
        return;
      }
      if (state === 'unauthorized') {
        await signOutAndClear();
        setSessionInvalid(true);
        setApiReady(false);
        setServerWaking(false);
        return;
      }
      window.setTimeout(() => { void tick(); }, 4000);
    };
    const timer = window.setTimeout(() => { void tick(); }, 4000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isLoaded, isSignedIn, serverWaking]);

  if (sessionInvalid) {
    return <Navigate to="/sign-in" replace />;
  }

  if (!isLoaded || (isSignedIn && !apiReady)) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center gap-3"
        style={{ background: '#0a0a0f' }}
      >
        <div className="font-display text-lg animate-torch" style={{ color: '#c9a84c' }}>
          Loading...
        </div>
        <p className="font-ui text-xs max-w-xs text-center" style={{ color: 'rgba(201,168,76,0.55)' }}>
          Waking the server — this can take a moment after deploy or when the database is busy.
        </p>
      </div>
    );
  }

  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return (
    <>
      {serverWaking && (
        <div
          className="font-ui text-xs text-center py-1.5 px-3 shrink-0"
          style={{ background: 'rgba(201,168,76,0.12)', color: '#c9a84c', borderBottom: '1px solid rgba(201,168,76,0.25)' }}
        >
          Server is still connecting — compendium and API may be slow for a few seconds.
        </div>
      )}
      <DdbImportJobBanner />
      {children}
    </>
  );
}

export default function App() {
  const { getToken, isSignedIn, isLoaded } = useGrimoireAuth();

  // Register before protected routes fire API calls (child effects run first).
  useLayoutEffect(() => {
    setAuthTokenGetter(async (opts) => (await getToken(opts)) ?? null);
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    void getToken({ skipCache: true });
    void hydrateSessionAfterOAuth(getToken);
  }, [isLoaded, isSignedIn, getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    const onExpired = () => {
      void signOutAndClear().then(() => {
        window.location.href = '/sign-in';
      });
    };
    window.addEventListener('grimoire:auth-expired', onExpired);
    return () => window.removeEventListener('grimoire:auth-expired', onExpired);
  }, [isLoaded, isSignedIn]);

  return (
    <Routes>
      {/* Public */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />

      {/* Protected */}
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/campaigns/:id"
        element={
          <ProtectedRoute>
            <CampaignDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/session/:sessionId"
        element={
          <ProtectedRoute>
            <SessionPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/join/:code"
        element={
          <ProtectedRoute>
            <JoinPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/support"
        element={
          <ProtectedRoute>
            <SupportPage />
          </ProtectedRoute>
        }
      />

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
