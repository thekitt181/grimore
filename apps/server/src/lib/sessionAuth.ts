import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { auth } from './auth';

export async function getSessionFromHeaders(headers: IncomingHttpHeaders) {
  return auth.api.getSession({
    headers: fromNodeHeaders(headers),
  });
}

export async function getAuthUserIdFromHeaders(headers: IncomingHttpHeaders): Promise<string | null> {
  const session = await getSessionFromHeaders(headers);
  if (session?.user?.id) return session.user.id;

  // A stale Authorization bearer (e.g. old localStorage token) can make getSession
  // return null even when the session cookie is still valid.
  const authz = headers.authorization;
  const cookie = headers.cookie;
  if (authz?.startsWith('Bearer ') && cookie) {
    const cookieSession = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    return cookieSession?.user?.id ?? null;
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
