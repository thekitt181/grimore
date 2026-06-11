import { createAuthClient } from 'better-auth/react';
import { dashClient } from '@better-auth/infra/client';
import { getServerOrigin } from './appUrls';

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
    onSuccess: (ctx) => {
      const authToken = ctx.response.headers.get('set-auth-token');
      if (authToken) setBearerToken(authToken);
    },
  },
});

export async function getAuthBearerToken(_opts?: { skipCache?: boolean }): Promise<string | null> {
  return getBearerToken();
}

export async function signOutAndClear(): Promise<void> {
  await authClient.signOut();
  setBearerToken(null);
}

/** Start Google OAuth — redirects on success; returns an error message otherwise. */
export async function signInWithGoogle(): Promise<string | null> {
  if (typeof window === 'undefined') return 'Google sign-in is unavailable';

  const callbackURL = `${window.location.origin}/`;
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
