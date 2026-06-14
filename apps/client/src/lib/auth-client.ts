import { createAuthClient } from 'better-auth/react';
import { dashClient } from '@better-auth/infra/client';
import { getPublicAppUrl, getServerOrigin } from './appUrls';

const BEARER_TOKEN_KEY = 'grimoire_bearer_token';

export function getBearerToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(BEARER_TOKEN_KEY);
}

export function setBearerToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token) localStorage.setItem(BEARER_TOKEN_KEY, token);
  else localStorage.removeItem(BEARER_TOKEN_KEY);
}

export const authClient = createAuthClient({
  baseURL: getServerOrigin(),
  plugins: [dashClient()] as never[],
  fetchOptions: {
    auth: {
      type: 'Bearer',
      token: () => getBearerToken() ?? '',
    },
    onSuccess: (ctx) => {
      const authToken = ctx.response.headers.get('set-auth-token');
      if (authToken) setBearerToken(authToken);
    },
  },
});

let bearerHydratePromise: Promise<string | null> | null = null;

async function hydrateBearerFromSession(): Promise<string | null> {
  try {
    const { data } = await authClient.getSession();
    if (!data?.session) return null;

    const fromHeader = getBearerToken();
    if (fromHeader) return fromHeader;

    const sessionToken = (data.session as { token?: string }).token;
    if (sessionToken) {
      setBearerToken(sessionToken);
      return sessionToken;
    }
  } catch (err) {
    console.warn('[Auth] Bearer token hydration failed:', err);
  }
  return getBearerToken();
}

/** Bearer token for Socket.io + API — hydrates from Better Auth session when missing (e.g. Google OAuth). */
export async function getAuthBearerToken(opts?: { skipCache?: boolean }): Promise<string | null> {
  if (!opts?.skipCache) {
    const cached = getBearerToken();
    if (cached) return cached;
  }

  if (!bearerHydratePromise || opts?.skipCache) {
    bearerHydratePromise = hydrateBearerFromSession();
  }
  return bearerHydratePromise;
}

export async function signOutAndClear(): Promise<void> {
  await authClient.signOut();
  setBearerToken(null);
  bearerHydratePromise = null;
}

/** Start Google OAuth — redirects on success; returns an error message otherwise. */
export async function signInWithGoogle(): Promise<string | null> {
  if (typeof window === 'undefined') return 'Google sign-in is unavailable';

  const callbackURL = `${getPublicAppUrl().replace(/\/$/, '')}/`;
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
