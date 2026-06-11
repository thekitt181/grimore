import { createAuthClient } from 'better-auth/react';
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
