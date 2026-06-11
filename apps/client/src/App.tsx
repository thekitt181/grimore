import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useGrimoireAuth } from '@/hooks/useGrimoireAuth';
import { setAuthTokenGetter } from '@/lib/axios';
import { Dashboard } from '@/pages/Dashboard';
import { CampaignDetail } from '@/pages/CampaignDetail';
import { SessionPage } from '@/pages/SessionPage';
import { JoinPage } from '@/pages/JoinPage';
import { SignInPage } from '@/pages/SignInPage';
import { SignUpPage } from '@/pages/SignUpPage';
import { DdbImportJobBanner } from '@/systems/ddb/DdbImportJobBanner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useGrimoireAuth();

  if (!isLoaded) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--color-bg-primary)' }}
      >
        <div className="font-display text-lg animate-torch" style={{ color: 'var(--color-accent-gold)' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!isSignedIn) return <Navigate to="/sign-in" replace />;
  return (
    <>
      <DdbImportJobBanner />
      {children}
    </>
  );
}

export default function App() {
  const { getToken } = useGrimoireAuth();

  // Register bearer token getter for axios interceptor (runs once on mount)
  useEffect(() => {
    setAuthTokenGetter(async (opts) => (await getToken(opts)) ?? null);
  }, [getToken]);

  return (
    <Routes>
      {/* Public */}
      <Route path="/sign-in/*" element={<SignInPage />} />
      <Route path="/sign-up/*" element={<SignUpPage />} />

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

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
