import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { auth } from './auth';
import { isDbPoolSaturation, isDbTransientError } from './dbTimeout';

export async function getSessionFromHeaders(headers: IncomingHttpHeaders) {
  try {
    return await auth.api.getSession({
      headers: fromNodeHeaders(headers),
    });
  } catch (err) {
    if (isDbPoolSaturation(err) || isDbTransientError(err)) throw err;
    console.error('[Auth] getSession failed:', err);
    return null;
  }
}

export async function getAuthUserIdFromHeaders(headers: IncomingHttpHeaders): Promise<string | null> {
  const session = await getSessionFromHeaders(headers);
  if (session?.user?.id) return session.user.id;

  // A stale Authorization bearer (e.g. old localStorage token) can make getSession
  // return null even when the session cookie is still valid.
  const authz = headers.authorization;
  const cookie = headers.cookie;
  if (authz?.startsWith('Bearer ') && cookie) {
    try {
      const cookieSession = await auth.api.getSession({
        headers: new Headers({ cookie }),
      });
      return cookieSession?.user?.id ?? null;
    } catch (err) {
      if (isDbPoolSaturation(err) || isDbTransientError(err)) throw err;
      console.error('[Auth] cookie session lookup failed:', err);
      return null;
    }
  }

  return null;
}

export async function getAuthUserIdFromRequest(
  headers: IncomingHttpHeaders,
  bearerToken?: string | null,
): Promise<string | null> {
  if (bearerToken?.trim()) {
    const session = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${bearerToken.trim()}` }),
    });
    if (session?.user?.id) return session.user.id;
  }
  return getAuthUserIdFromHeaders(headers);
}
