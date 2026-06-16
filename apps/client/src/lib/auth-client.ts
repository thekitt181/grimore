import { createAuthClient } from 'better-auth/react';
import { dashClient } from '@better-auth/infra/client';
import { getBrowserAppOrigin, getServerOrigin } from './appUrls';

const BEARER_TOKEN_KEY = 'grimoire_bearer_token';

export function getBearerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(BEARER_TOKEN_KEY);
}

function normalizeBearerToken(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function setBearerToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(BEARER_TOKEN_KEY, normalizeBearerToken(token));
  else localStorage.removeItem(BEARER_TOKEN_KEY);
}

export const authClient = createAuthClient({
  baseURL: getServerOrigin(),
  plugins: [dashClient()] as never[],
  fetchOptions: {
    credentials: 'include',
    auth: {
      type: 'Bearer',
      token: () => getBearerToken() || undefined,
    },
    onSuccess: (ctx) => {
      const authToken = ctx.response.headers.get('set-auth-token');
      if (authToken) setBearerToken(authToken);
    },
  },
});

let bearerHydratePromise: Promise<string | null> | null = null;

let sessionSnapshot: { at: number; hasSession: boolean } | null = null;
const SESSION_SNAPSHOT_MS = 15_000;

function invalidateSessionSnapshot(): void {
  sessionSnapshot = null;
}

async function hasActiveAuthSession(): Promise<boolean> {
  if (sessionSnapshot && Date.now() - sessionSnapshot.at < SESSION_SNAPSHOT_MS) {
    return sessionSnapshot.hasSession;
  }
  try {
    const { data } = await authClient.getSession();
    const hasSession = Boolean(data?.session);
    sessionSnapshot = { at: Date.now(), hasSession };
    return hasSession;
  } catch (err) {
    console.warn('[Auth] Session snapshot check failed:', err);
    return sessionSnapshot?.hasSession ?? true;
  }
}

async function hydrateBearerFromSession(): Promise<string | null> {
  try {
    const { data } = await authClient.getSession({
      fetchOptions: {
        onSuccess: (ctx) => {
          const authToken = ctx.response.headers.get('set-auth-token');
          if (authToken) setBearerToken(authToken);
        },
      },
    });
    if (!data?.session) {
      setBearerToken(null);
      return null;
    }
    return getBearerToken();
  } catch (err) {
    console.warn('[Auth] Bearer token hydration failed:', err);
  }
  return getBearerToken();
}

/** Bearer token for Socket.io + API — hydrates from Better Auth session when missing (e.g. Google OAuth). */
export async function getAuthBearerToken(opts?: { skipCache?: boolean }): Promise<string | null> {
  if (!opts?.skipCache) {
    const cached = getBearerToken();
    if (cached) {
      if (!(await hasActiveAuthSession())) {
        setBearerToken(null);
        bearerHydratePromise = null;
        invalidateSessionSnapshot();
        return null;
      }
      return cached;
    }
  }

  if (!bearerHydratePromise || opts?.skipCache) {
    bearerHydratePromise = hydrateBearerFromSession();
  }
  const token = await bearerHydratePromise;
  if (!token) setBearerToken(null);
  return token;
}

export async function signOutAndClear(): Promise<void> {
  await authClient.signOut();
  setBearerToken(null);
  bearerHydratePromise = null;
  invalidateSessionSnapshot();
}

/** Start Google OAuth — redirects on success; returns an error message otherwise. */
export async function signInWithGoogle(): Promise<string | null> {
  if (typeof window === 'undefined') return 'Google sign-in is unavailable';

  const callbackURL = `${getBrowserAppOrigin().replace(/\/$/, '')}/`;
  const result = await authClient.signIn.social({
    provider: 'google',
    callbackURL,
  });

  if (result.error) {
    const message = result.error.message ?? 'Google sign-in failed';
    if (/provider not found/i.test(message)) {
      return 'Google sign-in is not configured — add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on Render, then redeploy.';
    }
    return message;
  }

  const redirectUrl = result.data?.url;
  if (redirectUrl) {
    window.location.assign(redirectUrl);
    return null;
  }

  return 'Google sign-in did not start — check GOOGLE_CLIENT_ID on the server';
}
