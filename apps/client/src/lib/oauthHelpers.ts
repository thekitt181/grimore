/** Human-readable OAuth error codes from Better Auth callback redirects. */
const OAUTH_ERROR_MESSAGES: Record<string, string> = {
  state_mismatch: 'Sign-in session expired or cookies were blocked. Try again, or use Safari/Chrome instead of an in-app browser.',
  state_not_found: 'Sign-in session expired. Please try again.',
  invalid_code: 'Google authorization failed. Try again.',
  email_not_found: 'Google did not share an email address. Use email/password sign-in instead.',
  oauth_provider_not_found: 'Google sign-in is not configured on the server.',
  unable_to_get_user_info: 'Could not read your Google profile. Try again.',
  no_callback_url: 'Sign-in configuration error — contact support.',
  invalid_callback_request: 'Invalid sign-in response from Google. Try again.',
};

export function oauthErrorMessage(code: string | null, description: string | null): string | null {
  if (!code) return null;
  if (description?.trim()) return description.trim();
  return OAUTH_ERROR_MESSAGES[code] ?? `Google sign-in failed (${code.replace(/_/g, ' ')}). Try again.`;
}

/** After OAuth redirect, hydrate bearer token from the session cookie (with retries). */
export async function hydrateSessionAfterOAuth(
  getToken: (opts?: { skipCache?: boolean }) => Promise<string | null>,
  maxAttempts = 6,
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const token = await getToken({ skipCache: true });
    if (token) return true;
    await new Promise((r) => setTimeout(r, Math.min(800 * (attempt + 1), 4000)));
  }
  return false;
}
